import { FastifyInstance } from "fastify";
import { getPrisma } from "../db/client";
import { sendContactNotification } from "../utils/email";

const VALID_PLANS = ["starter", "growth", "strategic"];

// Rate limiter: 3 submissions per IP per 10 minutes
const contactRateLimits = new Map<string, { count: number; resetAt: number }>();
const CONTACT_RATE_LIMIT = 3;
const CONTACT_RATE_WINDOW_MS = 600_000;

function checkContactRateLimit(ip: string): boolean {
  const now = Date.now();
  const entry = contactRateLimits.get(ip);
  if (!entry || now >= entry.resetAt) {
    if (contactRateLimits.size > 10_000) {
      const oldest = contactRateLimits.keys().next().value!;
      contactRateLimits.delete(oldest);
    }
    contactRateLimits.set(ip, { count: 1, resetAt: now + CONTACT_RATE_WINDOW_MS });
    return true;
  }
  entry.count++;
  return entry.count <= CONTACT_RATE_LIMIT;
}

export async function contactRoute(app: FastifyInstance) {
  app.post(
    "/api/contact",
    { schema: { hide: true } },
    async (request, reply) => {
      if (!checkContactRateLimit(request.ip)) {
        return (reply as any).code(429).send({
          error: "Too many requests",
          code: "RATE_LIMIT_EXCEEDED",
          message: "Please wait before submitting another inquiry.",
        });
      }

      const { plan, name, email, company, message } = request.body as {
        plan?: string;
        name?: string;
        email?: string;
        company?: string;
        message?: string;
      };

      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!name || name.length > 200) {
        return (reply as any).code(400).send({
          error: "Validation failed",
          code: "VALIDATION_FAILED",
          message: "Name is required (max 200 characters).",
        });
      }
      if (!email || email.length > 254 || !emailRegex.test(email)) {
        return (reply as any).code(400).send({
          error: "Validation failed",
          code: "VALIDATION_FAILED",
          message: "A valid email address is required.",
        });
      }
      if (!message || message.length > 2000) {
        return (reply as any).code(400).send({
          error: "Validation failed",
          code: "VALIDATION_FAILED",
          message: "Message is required (max 2000 characters).",
        });
      }
      if (!plan || !VALID_PLANS.includes(plan)) {
        return (reply as any).code(400).send({
          error: "Validation failed",
          code: "VALIDATION_FAILED",
          message: "Invalid plan selection.",
        });
      }

      const prisma = getPrisma();
      if (prisma) {
        try {
          await prisma.contactInquiry.create({
            data: {
              plan,
              name,
              email,
              company: (company || "").slice(0, 200),
              message,
            },
          });
        } catch (err: any) {
          // If table doesn't exist yet, create it and retry
          if (err.code === "P2010" || err.message?.includes("contact_inquiries")) {
            try {
              await prisma.$executeRawUnsafe(`
                CREATE TABLE IF NOT EXISTS "contact_inquiries" (
                  "id" TEXT NOT NULL,
                  "plan" TEXT NOT NULL,
                  "name" TEXT NOT NULL,
                  "email" TEXT NOT NULL,
                  "company" TEXT NOT NULL DEFAULT '',
                  "message" TEXT NOT NULL,
                  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
                  CONSTRAINT "contact_inquiries_pkey" PRIMARY KEY ("id")
                )
              `);
              await prisma.contactInquiry.create({
                data: {
                  plan,
                  name,
                  email,
                  company: (company || "").slice(0, 200),
                  message,
                },
              });
            } catch (retryErr) {
              request.log.error(retryErr, "Failed to save contact inquiry after table creation");
              return (reply as any).code(500).send({
                error: "Internal error",
                code: "INTERNAL_ERROR",
                message: "Unable to submit inquiry. Please try again later.",
              });
            }
          } else {
            request.log.error(err, "Failed to save contact inquiry");
            return (reply as any).code(500).send({
              error: "Internal error",
              code: "INTERNAL_ERROR",
              message: "Unable to submit inquiry. Please try again later.",
            });
          }
        }
      }

      // Send email notification (fire-and-forget — don't block response)
      sendContactNotification({
        plan: plan!,
        name: name!,
        email: email!,
        company: (company || "").slice(0, 200),
        message: message!,
      }).catch((err) => request.log.warn(err, "Failed to send contact notification email"));

      request.log.info(
        { plan, email, name },
        "Enterprise contact inquiry received"
      );

      return reply.send({
        success: true,
        message: "Thank you! We'll be in touch within 1-2 business days.",
      });
    }
  );
}
