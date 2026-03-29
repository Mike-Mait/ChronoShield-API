import { FastifyInstance } from "fastify";
import crypto from "crypto";
import { config } from "../config/env";

/**
 * In-memory store for MVP. In production, use Postgres via Prisma.
 * Maps email -> { apiKey, tier, requestsUsed, requestsLimit, createdAt }
 */
const keyStore = new Map<
  string,
  {
    email: string;
    apiKey: string;
    tier: "free" | "pro";
    requestsUsed: number;
    requestsLimit: number;
    stripeCustomerId?: string;
    createdAt: Date;
  }
>();

// Also index by API key for lookups
const keyIndex = new Map<string, string>(); // apiKey -> email

export function generateApiKey(): string {
  const prefix = "cg_live_";
  const random = crypto.randomBytes(24).toString("base64url");
  return `${prefix}${random}`;
}

export function lookupKey(apiKey: string) {
  const email = keyIndex.get(apiKey);
  if (!email) return null;
  return keyStore.get(email) || null;
}

export function upgradeToProByEmail(email: string, stripeCustomerId: string) {
  const entry = keyStore.get(email);
  if (entry) {
    entry.tier = "pro";
    entry.requestsLimit = 100_000;
    entry.stripeCustomerId = stripeCustomerId;
  }
}

export async function keysRoute(app: FastifyInstance) {
  app.post(
    "/api/keys",
    { schema: { hide: true } },
    async (request, reply) => {
      const { email, tier } = request.body as {
        email?: string;
        tier?: string;
      };

      if (!email || !email.includes("@")) {
        return (reply as any).code(400).send({ error: "Valid email is required" });
      }

      // Check if user already has a key
      const existing = keyStore.get(email);

      if (tier === "pro") {
        // Generate key now, but mark as free until payment completes
        let apiKey: string;
        if (existing) {
          apiKey = existing.apiKey;
        } else {
          apiKey = generateApiKey();
          keyStore.set(email, {
            email,
            apiKey,
            tier: "free",
            requestsUsed: 0,
            requestsLimit: 1_000,
            createdAt: new Date(),
          });
          keyIndex.set(apiKey, email);
        }

        // Create Stripe Checkout session
        if (!config.stripeSecretKey) {
          // Stripe not configured — return key directly as free tier
          return reply.send({
            api_key: apiKey,
            tier: "free",
            message: "Payment processing not configured. Key issued as free tier.",
          });
        }

        try {
          const stripe = require("stripe")(config.stripeSecretKey);

          const session = await stripe.checkout.sessions.create({
            mode: "subscription",
            payment_method_types: ["card"],
            customer_email: email,
            line_items: [
              {
                price: config.stripePriceId,
                quantity: 1,
              },
            ],
            metadata: { email, api_key: apiKey },
            success_url: `${config.baseUrl}/?checkout=success&key=${apiKey}`,
            cancel_url: `${config.baseUrl}/?checkout=cancelled`,
          });

          return reply.send({
            api_key: apiKey,
            checkout_url: session.url,
            message: "Complete payment to activate Pro tier.",
          });
        } catch (err: any) {
          request.log.error(err, "Stripe checkout session creation failed");
          return (reply as any).code(500).send({
            error: "Failed to create checkout session",
          });
        }
      }

      // Free tier
      if (existing) {
        return reply.send({
          api_key: existing.apiKey,
          tier: existing.tier,
          requests_limit: existing.requestsLimit,
          message: "Existing key returned.",
        });
      }

      const apiKey = generateApiKey();
      keyStore.set(email, {
        email,
        apiKey,
        tier: "free",
        requestsUsed: 0,
        requestsLimit: 1_000,
        createdAt: new Date(),
      });
      keyIndex.set(apiKey, email);

      return reply.send({
        api_key: apiKey,
        tier: "free",
        requests_limit: 1_000,
      });
    }
  );
}
