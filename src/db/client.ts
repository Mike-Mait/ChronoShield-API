import { PrismaClient } from "@prisma/client";
import { config } from "../config/env";

let prisma: PrismaClient | null = null;

/**
 * Returns a Prisma client if DATABASE_URL is configured,
 * or null if running without a database (e.g., local dev without Postgres).
 */
export function getPrisma(): PrismaClient | null {
  if (!config.databaseUrl) return null;
  if (!prisma) {
    prisma = new PrismaClient({
      log: process.env.NODE_ENV !== "production" ? ["warn", "error"] : ["error"],
    });
  }
  return prisma;
}

/**
 * Verifies the DB schema is present before the server starts serving traffic.
 *
 * The "production had no tables for weeks" bug happened because every DB
 * read was wrapped in a silent catch that fell through to memory, so the
 * missing schema was invisible. This probe is the belt: if `api_keys`
 * isn't queryable at boot, we crash the process with a loud message
 * instead of letting the server come up in a broken state and issue
 * ghost keys.
 *
 * Uses `LIMIT 0` so it doesn't touch rows — purely a schema check.
 *
 * No-ops (returns) when DATABASE_URL isn't configured, so `npm run dev`
 * without a local Postgres still works.
 */
export async function verifySchema(): Promise<void> {
  const client = getPrisma();
  if (!client) return;

  try {
    await client.$queryRaw`SELECT 1 FROM "api_keys" LIMIT 0`;
  } catch (err: any) {
    const msg = err?.message || String(err);
    console.error(
      "[schema] FATAL: api_keys table is not queryable. " +
        "This usually means Prisma migrations did not run. " +
        "Check that the Dockerfile copies src/db/prisma/migrations/ " +
        "and that `prisma migrate deploy` succeeded on boot. " +
        `Underlying error: ${msg}`
    );
    throw new Error(`Schema verification failed: ${msg}`);
  }
}

export async function disconnectPrisma(): Promise<void> {
  if (prisma) {
    await prisma.$disconnect();
    prisma = null;
  }
}
