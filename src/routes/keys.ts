import { FastifyInstance } from "fastify";
import crypto from "crypto";
import { config, getStripe } from "../config/env";
import { getPrisma } from "../db/client";

// ─── Types ───
interface KeyEntry {
  id?: string;
  email: string;
  apiKey: string;
  tier: "free" | "pro";
  requestsUsed: number;
  requestsLimit: number;
  stripeCustomerId?: string;
  resetAt: Date;
  createdAt: Date;
}

// ─── Usage reset helpers ───
function getNextResetDate(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
}

function isResetDue(resetAt: Date): boolean {
  return new Date() >= resetAt;
}

// ─── In-memory fallback (used when DATABASE_URL is not set) ───
const MAX_CACHE_SIZE = 10_000;
const memoryKeyStore = new Map<string, KeyEntry>();
const memoryKeyIndex = new Map<string, string>(); // apiKey -> email

function evictOldestIfNeeded<K, V>(map: Map<K, V>, limit: number): void {
  if (map.size > limit) {
    const oldest = map.keys().next().value!;
    map.delete(oldest);
  }
}

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

      // Lazy monthly reset
      let { requestsUsed } = record;
      if (isResetDue(record.resetAt)) {
        const nextReset = getNextResetDate();
        await prisma.apiKey.update({
          where: { keyHash: hashKey(apiKey) },
          data: { requestsUsed: 0, resetAt: nextReset },
        });
        requestsUsed = 0;
      }

      return {
        id: record.id,
        email: record.email,
        apiKey, // we don't store the raw key, but the caller already has it
        tier: record.tier as "free" | "pro",
        requestsUsed,
        requestsLimit: record.requestsLimit,
        stripeCustomerId: record.stripeCustomerId ?? undefined,
        resetAt: record.resetAt,
        createdAt: record.createdAt,
      };
    } catch {
      // DB error — fall through to memory
    }
  }

  // Fallback to in-memory
  const email = memoryKeyIndex.get(apiKey);
  if (!email) return null;
  const memEntry = memoryKeyStore.get(email);
  if (!memEntry) return null;

  // Lazy monthly reset (in-memory)
  if (isResetDue(memEntry.resetAt)) {
    memEntry.requestsUsed = 0;
    memEntry.resetAt = getNextResetDate();
    const cached = keyCache.get(apiKey);
    if (cached) {
      cached.requestsUsed = 0;
      cached.resetAt = getNextResetDate();
    }
  }

  return memEntry;
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
      const existing = await prisma.apiKey.findUnique({ where: { email } });
      if (existing?.stripeCustomerId && existing.stripeCustomerId !== stripeCustomerId) {
        console.warn(
          `Stripe customer ID changing for ${email}: ${existing.stripeCustomerId} → ${stripeCustomerId}`
        );
      }
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

// ─── Downgrade to Free by Stripe Customer ID ───
export async function downgradeToFreeByStripeCustomerId(stripeCustomerId: string): Promise<boolean> {
  const prisma = getPrisma();
  if (prisma) {
    try {
      const record = await prisma.apiKey.findFirst({
        where: { stripeCustomerId },
      });
      if (!record) return false;

      await prisma.apiKey.update({
        where: { email: record.email },
        data: {
          tier: "free",
          requestsLimit: 1_000,
        },
      });

      // Also update memory/cache
      const entry = memoryKeyStore.get(record.email);
      if (entry) {
        entry.tier = "free";
        entry.requestsLimit = 1_000;
        const cached = keyCache.get(entry.apiKey);
        if (cached) {
          cached.tier = "free";
          cached.requestsLimit = 1_000;
        }
      }

      return true;
    } catch {
      return false;
    }
  }

  // Fallback: search in-memory store
  for (const [email, entry] of memoryKeyStore) {
    if (entry.stripeCustomerId === stripeCustomerId) {
      entry.tier = "free";
      entry.requestsLimit = 1_000;
      const cached = keyCache.get(entry.apiKey);
      if (cached) {
        cached.tier = "free";
        cached.requestsLimit = 1_000;
      }
      return true;
    }
  }

  return false;
}

// ─── Create or retrieve a key ───
interface CreateKeyResult {
  apiKey: string | null;
  isExisting: boolean;
  entry: KeyEntry | null;
  dbTier?: string;
  dbRequestsLimit?: number;
  dbStripeCustomerId?: string | null;
}

async function createOrGetKey(
  email: string,
  tier: "free" | "pro"
): Promise<CreateKeyResult> {
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
        // Don't regenerate — that would invalidate the user's saved key.
        return {
          apiKey: null,
          isExisting: true,
          entry: null,
          dbTier: existing.tier as "free" | "pro",
          dbRequestsLimit: existing.requestsLimit,
          dbStripeCustomerId: existing.stripeCustomerId,
        };
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
  const resetAt = getNextResetDate();
  const entry: KeyEntry = {
    email,
    apiKey,
    tier: "free", // start as free until payment
    requestsUsed: 0,
    requestsLimit: 1_000,
    resetAt,
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
          resetAt,
        },
      });
    } catch {
      // DB error — continue with memory only
    }
  }
  evictOldestIfNeeded(memoryKeyStore, MAX_CACHE_SIZE);
  evictOldestIfNeeded(memoryKeyIndex, MAX_CACHE_SIZE);
  evictOldestIfNeeded(keyCache, MAX_CACHE_SIZE);
  memoryKeyStore.set(email, entry);
  memoryKeyIndex.set(apiKey, email);
  keyCache.set(apiKey, entry);

  return { apiKey, isExisting: false, entry };
}

// ─── Rate limiter for /api/keys ───
const keyRequestCounts = new Map<string, { count: number; resetAt: number }>();
const KEY_RATE_LIMIT = 10; // max requests per window
const KEY_RATE_WINDOW_MS = 60_000; // 1 minute

function checkKeyRateLimit(ip: string): boolean {
  const now = Date.now();
  const entry = keyRequestCounts.get(ip);
  if (!entry || now >= entry.resetAt) {
    evictOldestIfNeeded(keyRequestCounts, MAX_CACHE_SIZE);
    keyRequestCounts.set(ip, { count: 1, resetAt: now + KEY_RATE_WINDOW_MS });
    return true;
  }
  entry.count++;
  return entry.count <= KEY_RATE_LIMIT;
}

// ─── Route ───
export async function keysRoute(app: FastifyInstance) {
  app.post(
    "/api/keys",
    { schema: { hide: true } },
    async (request, reply) => {
      const clientIp = request.ip;
      if (!checkKeyRateLimit(clientIp)) {
        return (reply as any).code(429).send({
          error: "Too many requests",
          code: "RATE_LIMIT_EXCEEDED",
          message: "Too many key requests. Please try again in a minute.",
        });
      }

      const { email, tier } = request.body as {
        email?: string;
        tier?: string;
      };

      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!email || email.length > 254 || !emailRegex.test(email)) {
        return (reply as any).code(400).send({
          error: "Valid email is required",
          code: "VALIDATION_FAILED",
          message: "Provide a valid email address to generate an API key.",
        });
      }

      const result = await createOrGetKey(
        email,
        (tier as "free" | "pro") || "free"
      );

      // Key exists in DB but can't be recovered (server restarted)
      if (result.isExisting && result.apiKey === null) {
        if (tier === "pro") {
          // Block if already on Pro
          if (result.dbTier === "pro") {
            return reply.send({
              tier: "pro",
              message: "This account is already subscribed to Pro. Use the API key you were given when you first signed up.",
            });
          }

          // Still allow Pro upgrade — webhook upgrades by email
          if (!config.stripeSecretKey) {
            return reply.send({
              tier: result.dbTier,
              message: "Payment processing not configured. Use the API key you were given when you first signed up.",
            });
          }

          try {
            const stripe = getStripe();

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
              metadata: { email },
              success_url: `${config.baseUrl}/?checkout=success`,
              cancel_url: `${config.baseUrl}/?checkout=cancelled`,
            });

            return reply.send({
              checkout_url: session.url,
              message: "Complete payment to upgrade your existing key to Pro.",
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

        return reply.send({
          tier: result.dbTier,
          requests_limit: result.dbRequestsLimit,
          message: "A key already exists for this email. Use the API key you were given when you first signed up.",
        });
      }

      const { apiKey, isExisting, entry } = result as {
        apiKey: string;
        isExisting: boolean;
        entry: KeyEntry;
      };

      if (tier === "pro") {
        // Block if already on Pro
        if (entry.tier === "pro") {
          return reply.send({
            api_key: apiKey,
            tier: "pro",
            requests_limit: entry.requestsLimit,
            message: "This account is already subscribed to Pro.",
          });
        }

        // Create Stripe Checkout session
        if (!config.stripeSecretKey) {
          return reply.send({
            api_key: apiKey,
            tier: "free",
            message: "Payment processing not configured. Key issued as free tier.",
          });
        }

        try {
          const stripe = getStripe();

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
            metadata: { email },
            success_url: `${config.baseUrl}/?checkout=success`,
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
