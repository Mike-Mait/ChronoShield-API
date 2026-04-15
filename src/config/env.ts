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
  smtpHost: process.env.SMTP_HOST || "",
  smtpPort: parseInt(process.env.SMTP_PORT || "587", 10),
  smtpUser: process.env.SMTP_USER || "",
  smtpPass: process.env.SMTP_PASS || "",
  smtpFrom: process.env.SMTP_FROM || "sales@chronoshieldapi.com",
  // Security/account mail (key resets, admin handoffs). Falls back to
  // smtpFrom so deploys that haven't set this var yet still send, just from
  // the generic sales address. Setting SMTP_FROM_SUPPORT=support@... lets
  // reset mail come from a support-toned address without touching marketing
  // mail reputation.
  smtpFromSupport: process.env.SMTP_FROM_SUPPORT || process.env.SMTP_FROM || "support@chronoshieldapi.com",
  contactNotifyEmail: process.env.CONTACT_NOTIFY_EMAIL || "sales@chronoshieldapi.com",
  sentryDsn: process.env.SENTRY_DSN || "",
  nodeEnv: process.env.NODE_ENV || "development",
  resetTokenSecret: process.env.RESET_TOKEN_SECRET || "",
};

// Warn loudly in production if reset-token secret is missing. Falls back to
// API_KEY so a rushed deploy doesn't break, but this is a degraded state.
if (!config.resetTokenSecret && config.nodeEnv === "production") {
  console.warn(
    "[config] RESET_TOKEN_SECRET is not set. Falling back to API_KEY for reset tokens. Set a dedicated 32+ byte secret before handling real traffic."
  );
}
export const resetTokenSigningKey = config.resetTokenSecret || config.apiKey || "dev-reset-secret-do-not-use-in-prod";

// ─── Stripe singleton ───
let stripeInstance: any = null;

export function getStripe(): any | null {
  if (!config.stripeSecretKey) return null;
  if (!stripeInstance) {
    stripeInstance = require("stripe")(config.stripeSecretKey);
  }
  return stripeInstance;
}
