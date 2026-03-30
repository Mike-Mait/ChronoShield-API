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

export async function disconnectPrisma(): Promise<void> {
  if (prisma) {
    await prisma.$disconnect();
    prisma = null;
  }
}
