import { FastifyInstance } from "fastify";
import crypto from "crypto";
import { config } from "../config/env";
import { getPrisma } from "../db/client";

// ─── Types ───
interface KeyEntry {
  email: string;
  apiKey: string;
  tier: "free" | "pro";
  requestsUsed: number;
  requestsLimit: number;
  stripeCustomerId?: string;
  createdAt: Date;
}

// ─── In-memory fallback (used when DATABASE_URL is not set) ───
const memoryKeyStore = new Map<string, KeyEntry>();
const memoryKeyIndex = new Map<string, string>(); // apiKey -> email

// ─── Key generation ───
export function generateApiKey(): string {
  const prefix = "cg_live_";
  const random = crypto.randomBytes(24).toString("base64url");
  return `${prefix}${random}`;
}

function hashKey(apiKey: string): string {
  return crypto.createHash("sha256").update(apiKey).digest("hex");
}

// ─── Lookup: checks Prisma first, falls back to in-memory ───
export async function lookupKeyAsync(apiKey: string): Promise<KeyEntry | null> {
  const prisma = getPrisma();
  if (prisma) {
    try {
      const record = await prisma.apiKey.findUnique({
        where: { keyHash: hashKey(apiKey) },
      });
      if (!record || !record.active) return null;
      return {
        email: record.email,
        apiKey, // we don't store the raw key, but the caller already has it
        tier: record.tier as "free" | "pro",
        requestsUsed: record.requestsUsed,
        requestsLimit: record.requestsLimit,
        stripeCustomerId: record.stripeCustomerId ?? undefined,
        createdAt: record.createdAt,
      };
    } catch {
      // DB error — fall through to memory
    }
  }

  // Fallback to in-memory
  const email = memoryKeyIndex.get(apiKey);
  if (!email) return null;
  return memoryKeyStore.get(email) || null;
}

// Synchronous wrapper for auth hook compatibility
// Uses a cached Map that's populated on key creation and lookup
const keyCache = new Map<string, KeyEntry>();

export function lookupKey(apiKey: string): KeyEntry | null {
  return keyCache.get(apiKey) || null;
}

// ─── Increment usage ───
export async function incrementUsageAsync(apiKey: string): Promise<void> {
  const prisma = getPrisma();
  if (prisma) {
    try {
      await prisma.apiKey.update({
        where: { keyHash: hashKey(apiKey) },
        data: { requestsUsed: { increment: 1 } },
      });
    } catch {
      // DB error — fall through to memory
    }
  }

  // Also update memory/cache
  const cached = keyCache.get(apiKey);
  if (cached) cached.requestsUsed++;

  const email = memoryKeyIndex.get(apiKey);
  if (email) {
    const entry = memoryKeyStore.get(email);
    if (entry) entry.requestsUsed++;
  }
}

export function incrementUsage(apiKey: string): void {
  // Fire and forget the async version
  incrementUsageAsync(apiKey).catch(() => {});
}

// ─── Upgrade to Pro ───
export async function upgradeToProByEmail(email: string, stripeCustomerId: string): Promise<void> {
  const prisma = getPrisma();
  if (prisma) {
    try {
      await prisma.apiKey.update({
        where: { email },
        data: {
          tier: "pro",
          requestsLimit: 100_000,
          stripeCustomerId,
        },
      });
    } catch {
      // DB error — fall through to memory
    }
  }

  // Also update memory/cache
  const entry = memoryKeyStore.get(email);
  if (entry) {
    entry.tier = "pro";
    entry.requestsLimit = 100_000;
    entry.stripeCustomerId = stripeCustomerId;
    const cached = keyCache.get(entry.apiKey);
    if (cached) {
      cached.tier = "pro";
      cached.requestsLimit = 100_000;
      cached.stripeCustomerId = stripeCustomerId;
    }
  }
}

// ─── Create or retrieve a key ───
async function createOrGetKey(
  email: string,
  tier: "free" | "pro"
): Promise<{ apiKey: string; isExisting: boolean; entry: KeyEntry }> {
  const prisma = getPrisma();

  // Check Prisma first
  if (prisma) {
    try {
      const existing = await prisma.apiKey.findUnique({ where: { email } });
      if (existing) {
        // Can't recover the raw key from hash — so we check memory
        const memEntry = memoryKeyStore.get(email);
        if (memEntry) {
          return { apiKey: memEntry.apiKey, isExisting: true, entry: memEntry };
        }
        // Key exists in DB but not in memory (server restarted).
        // Generate a new key and update the DB record.
        const newKey = generateApiKey();
        await prisma.apiKey.update({
          where: { email },
          data: { keyHash: hashKey(newKey) },
        });
        const entry: KeyEntry = {
          email,
          apiKey: newKey,
          tier: existing.tier as "free" | "pro",
          requestsUsed: existing.requestsUsed,
          requestsLimit: existing.requestsLimit,
          stripeCustomerId: existing.stripeCustomerId ?? undefined,
          createdAt: existing.createdAt,
        };
        memoryKeyStore.set(email, entry);
        memoryKeyIndex.set(newKey, email);
        keyCache.set(newKey, entry);
        return { apiKey: newKey, isExisting: true, entry };
      }
    } catch {
      // DB error — fall through to memory-only
    }
  }

  // Check memory
  const memExisting = memoryKeyStore.get(email);
  if (memExisting) {
    return { apiKey: memExisting.apiKey, isExisting: true, entry: memExisting };
  }

  // Create new key
  const apiKey = generateApiKey();
  const limit = tier === "pro" ? 100_000 : 1_000;
  const entry: KeyEntry = {
    email,
    apiKey,
    tier: tier === "pro" ? "free" : "free", // start as free until payment
    requestsUsed: 0,
    requestsLimit: limit,
    createdAt: new Date(),
  };

  // Persist to DB
  if (prisma) {
    try {
      await prisma.apiKey.create({
        data: {
          email,
          keyHash: hashKey(apiKey),
          tier: "free",
          requestsUsed: 0,
          requestsLimit: 1_000,
        },
      });
    } catch {
      // DB error — continue with memory only
    }
  }

  // Always store in memory + cache
  entry.requestsLimit = 1_000; // always start as free
  memoryKeyStore.set(email, entry);
  memoryKeyIndex.set(apiKey, email);
  keyCache.set(apiKey, entry);

  return { apiKey, isExisting: false, entry };
}

// ─── Route ───
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
        return (reply as any).code(400).send({
          error: "Valid email is required",
          code: "VALIDATION_FAILED",
          message: "Provide a valid email address to generate an API key.",
        });
      }

      const { apiKey, isExisting, entry } = await createOrGetKey(
        email,
        (tier as "free" | "pro") || "free"
      );

      if (tier === "pro") {
        // Create Stripe Checkout session
        if (!config.stripeSecretKey) {
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
            code: "CHECKOUT_FAILED",
            message: "Unable to initialize payment. Please try again later.",
          });
        }
      }

      // Free tier
      if (isExisting) {
        return reply.send({
          api_key: apiKey,
          tier: entry.tier,
          requests_limit: entry.requestsLimit,
          message: "Existing key returned.",
        });
      }

      return reply.send({
        api_key: apiKey,
        tier: "free",
        requests_limit: 1_000,
      });
    }
  );
}
