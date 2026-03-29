import dotenv from "dotenv";
dotenv.config();

export const config = {
  port: parseInt(process.env.PORT || "3000", 10),
  host: process.env.HOST || "0.0.0.0",
  logLevel: process.env.LOG_LEVEL || "info",
  databaseUrl: process.env.DATABASE_URL || "",
  redisUrl: process.env.REDIS_URL || "",
  apiKey: process.env.API_KEY || "",
  baseUrl: process.env.BASE_URL || `http://localhost:${process.env.PORT || "3000"}`,
  stripeSecretKey: process.env.STRIPE_SECRET_KEY || "",
  stripePriceId: process.env.STRIPE_PRICE_ID || "",
  stripeWebhookSecret: process.env.STRIPE_WEBHOOK_SECRET || "",
};
