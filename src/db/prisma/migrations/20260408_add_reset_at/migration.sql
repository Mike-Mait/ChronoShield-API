-- AlterTable: Add reset_at column for monthly usage reset
ALTER TABLE "api_keys" ADD COLUMN "reset_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
