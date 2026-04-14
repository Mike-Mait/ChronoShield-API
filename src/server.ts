import { initSentry, captureException } from "./config/sentry";
initSentry(); // Must run before other imports that might throw

import path from "path";
import fs from "fs";
import Fastify from "fastify";
import fastifyCors from "@fastify/cors";
import fastifySwagger from "@fastify/swagger";
import fastifySwaggerUi from "@fastify/swagger-ui";
import { config } from "./config/env";
import { validateRoute } from "./routes/validate";
import { resolveRoute } from "./routes/resolve";
import { convertRoute } from "./routes/convert";
import { keysRoute } from "./routes/keys";
import { batchRoute } from "./routes/batch";
import { webhooksRoute } from "./routes/webhooks";
import { contactRoute } from "./routes/contact";
import { adminRoute } from "./routes/admin";
import { AppError } from "./utils/errors";
import { lookupKeyAsync, incrementUsage } from "./routes/keys";
import { getPrisma, disconnectPrisma } from "./db/client";

const app = Fastify({
  logger: {
    level: config.logLevel,
    transport:
      process.env.NODE_ENV !== "production"
        ? { target: "pino-pretty", options: { colorize: true } }
        : undefined,
  },
  genReqId: () => crypto.randomUUID(),
  bodyLimit: 1_048_576, // 1 MB
  trustProxy: true, // Railway runs behind a reverse proxy
});

// Paths that skip API key auth
const publicPaths = ["/health", "/status", "/docs", "/api/keys", "/api/webhooks", "/api/contact", "/docs/playground", "/terms", "/privacy", "/aup", "/.well-known", "/favicon", "/logo"];

// API key auth hook
app.addHook("onRequest", async (request, reply) => {
  // Skip auth for CORS preflight requests
  if (request.method === "OPTIONS") return;

  const pathname = request.url.split("?")[0];
  if (
    pathname === "/" ||
    publicPaths.some((p) => pathname.startsWith(p)) ||
    pathname.startsWith("/docs/") ||
    pathname.startsWith("/assets")
  ) {
    return;
  }

  const apiKey = request.headers["x-api-key"] as string | undefined;
  if (!apiKey) {
    return reply.code(401).send({
      error: "Unauthorized",
      code: "UNAUTHORIZED",
      message: "Missing or invalid API key. Pass your key via the x-api-key header.",
    });
  }

  // Check master key from environment
  if (config.apiKey && apiKey === config.apiKey) {
    return;
  }

  // Check dynamically generated keys from keyStore (DB + memory)
  const keyEntry = await lookupKeyAsync(apiKey);
  if (!keyEntry) {
    return reply.code(401).send({
      error: "Unauthorized",
      code: "UNAUTHORIZED",
      message: "Missing or invalid API key. Pass your key via the x-api-key header.",
    });
  }

  // Store for rate-limit headers
  (request as any).keyEntry = keyEntry;

  // Enforce rate limits
  if (keyEntry.requestsUsed >= keyEntry.requestsLimit) {
    return reply.code(429).send({
      error: "Rate limit exceeded",
      code: "RATE_LIMIT_EXCEEDED",
      message: keyEntry.tier === "free"
        ? "Upgrade to Pro for 100,000 requests/month."
        : "Contact us for enterprise limits.",
      requests_used: keyEntry.requestsUsed,
      requests_limit: keyEntry.requestsLimit,
      reset_at: keyEntry.resetAt?.toISOString() || null,
    });
  }

  // Increment usage
  incrementUsage(apiKey);
});

// API version + rate-limit + security headers
app.addHook("onSend", async (request, reply) => {
  reply.header("X-API-Version", "1.3.0");
  reply.header("X-Powered-By", "ChronoShield API");
  reply.header("X-Content-Type-Options", "nosniff");
  reply.header("X-Frame-Options", "DENY");
  reply.header("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  reply.header("Referrer-Policy", "strict-origin-when-cross-origin");
  reply.header("Permissions-Policy", "geolocation=(), microphone=(), camera=()");

  // Prevent caching of API responses
  const pathname = request.url.split("?")[0];
  if (pathname.startsWith("/v1/") || pathname.startsWith("/api/")) {
    reply.header("Cache-Control", "no-store");
  }

  const keyEntry = (request as any).keyEntry;
  if (keyEntry) {
    reply.header("X-RateLimit-Limit", keyEntry.requestsLimit);
    reply.header("X-RateLimit-Remaining", Math.max(0, keyEntry.requestsLimit - keyEntry.requestsUsed - 1));
    if (keyEntry.resetAt) {
      reply.header("X-RateLimit-Reset", Math.floor(keyEntry.resetAt.getTime() / 1000));
    }
  }
});

// Request logging hook
app.addHook("onResponse", async (request, reply) => {
  request.log.info(
    {
      method: request.method,
      url: request.url,
      statusCode: reply.statusCode,
      responseTime: reply.elapsedTime,
    },
    "request completed"
  );

  // Write to RequestLog for authenticated API requests
  const keyEntry = (request as any).keyEntry;
  if (keyEntry) {
    const prisma = getPrisma();
    if (prisma) {
      prisma.requestLog.create({
        data: {
          endpoint: request.url.split("?")[0],
          method: request.method,
          statusCode: reply.statusCode,
          latencyMs: reply.elapsedTime,
          apiKeyId: keyEntry.id || null,
        },
      }).catch((err: unknown) => {
        request.log.warn(err, "Failed to write request log");
      });
    }
  }
});

// Global error handler
app.setErrorHandler(async (error, request, reply) => {
  if (error instanceof AppError) {
    return reply.code(error.statusCode).send({
      error: error.message,
      code: error.code || "APP_ERROR",
      message: error.message,
    });
  }

  request.log.error(error);
  captureException(error, {
    method: request.method,
    url: request.url,
    requestId: request.id,
  });
  return reply.code(500).send({
    error: "Internal server error",
    code: "INTERNAL_ERROR",
    message: "An unexpected error occurred.",
  });
});

async function start() {
  // Pre-load brand assets (SVG) so they can be wired into both route handlers
  // and the Swagger UI theme config below.
  const faviconSvg = fs.readFileSync(path.join(__dirname, "public", "favicon.svg"), "utf-8");
  const logoSvg = fs.readFileSync(path.join(__dirname, "public", "logo.svg"), "utf-8");

  // CORS
  await app.register(fastifyCors, {
    origin: true,
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "x-api-key"],
    exposedHeaders: ["X-API-Version", "X-Powered-By", "X-RateLimit-Limit", "X-RateLimit-Remaining", "X-RateLimit-Reset"],
  });

  // Swagger / OpenAPI
  await app.register(fastifySwagger, {
    openapi: {
      openapi: "3.1.0",
      info: {
        title: "ChronoShield API",
        description: "DST-aware datetime validation, resolution, and conversion API.\n\n**Need an API key?** [Get one free on the homepage](/) — no credit card required. Then click **Authorize** above and paste your key.",
        version: "1.3.0",
      },
      servers: [
        { url: config.baseUrl, description: "Production" },
        { url: `http://localhost:${config.port}`, description: "Local development" },
      ],
      components: {
        securitySchemes: {
          apiKey: {
            type: "apiKey",
            name: "x-api-key",
            in: "header",
          },
        },
      },
      security: [{ apiKey: [] }],
    },
  });

  await app.register(fastifySwaggerUi, {
    routePrefix: "/docs/playground",
    theme: {
      title: "ChronoShield API — Playground",
      favicon: [
        {
          filename: "favicon.svg",
          rel: "icon",
          type: "image/svg+xml",
          sizes: "any",
          content: faviconSvg,
        },
      ],
    },
  });

  // Health check (simple)
  app.get("/health", { schema: { hide: true } }, async () => ({ status: "ok" }));

  // Status page (detailed operational info)
  const startedAt = new Date();
  app.get("/status", { schema: { hide: true } }, async () => {
    const uptimeMs = Date.now() - startedAt.getTime();
    const uptimeSec = Math.floor(uptimeMs / 1000);
    const days = Math.floor(uptimeSec / 86400);
    const hours = Math.floor((uptimeSec % 86400) / 3600);
    const minutes = Math.floor((uptimeSec % 3600) / 60);

    let dbStatus = "not_configured";
    const prismaClient = getPrisma();
    if (prismaClient) {
      try {
        await prismaClient.$queryRaw`SELECT 1`;
        dbStatus = "connected";
      } catch {
        dbStatus = "error";
      }
    }

    return {
      status: "operational",
      version: "1.3.0",
      uptime: `${days}d ${hours}h ${minutes}m`,
      uptime_seconds: uptimeSec,
      started_at: startedAt.toISOString(),
      database: dbStatus,
      timezone_data: {
        iana_version: process.versions.tz || "unknown",
      },
      endpoints: {
        validate: "/v1/datetime/validate",
        resolve: "/v1/datetime/resolve",
        convert: "/v1/datetime/convert",
        batch: "/v1/datetime/batch",
      },
      documentation: "/docs",
      playground: "/docs/playground",
      changelog: "https://github.com/Mike-Mait/ChronoShield-API/blob/master/CHANGELOG.md",
    };
  });

  // Pre-load static HTML files into memory
  const htmlCache: Record<string, string> = {};
  for (const page of ["index", "docs", "terms", "privacy", "aup"]) {
    htmlCache[page] = fs.readFileSync(path.join(__dirname, "public", `${page}.html`), "utf-8");
  }

  app.get("/favicon.svg", { schema: { hide: true } }, async (_request, reply) => {
    return reply
      .type("image/svg+xml")
      .header("Cache-Control", "public, max-age=86400")
      .send(faviconSvg);
  });

  app.get("/logo.svg", { schema: { hide: true } }, async (_request, reply) => {
    return reply
      .type("image/svg+xml")
      .header("Cache-Control", "public, max-age=86400")
      .send(logoSvg);
  });

  // Custom docs page
  app.get("/docs", { schema: { hide: true } }, async (_request, reply) => {
    return reply.type("text/html").send(htmlCache.docs);
  });

  // Terms of Service
  app.get("/terms", { schema: { hide: true } }, async (_request, reply) => {
    return reply.type("text/html").send(htmlCache.terms);
  });

  // Privacy Policy
  app.get("/privacy", { schema: { hide: true } }, async (_request, reply) => {
    return reply.type("text/html").send(htmlCache.privacy);
  });

  // Acceptable Use Policy
  app.get("/aup", { schema: { hide: true } }, async (_request, reply) => {
    return reply.type("text/html").send(htmlCache.aup);
  });

  // Security.txt (IETF RFC 9116)
  const securityTxt = [
    "Contact: mailto:security@chronoshieldapi.com",
    "Preferred-Languages: en",
    "Canonical: https://chronoshieldapi.com/.well-known/security.txt",
    `Expires: ${new Date(Date.now() + 365 * 86400000).toISOString()}`,
  ].join("\n");

  app.get("/.well-known/security.txt", { schema: { hide: true } }, async (_request, reply) => {
    return reply.type("text/plain").send(securityTxt);
  });

  // Landing page
  app.get("/", { schema: { hide: true } }, async (_request, reply) => {
    return reply.type("text/html").send(htmlCache.index);
  });

  // API routes
  await app.register(validateRoute);
  await app.register(resolveRoute);
  await app.register(convertRoute);
  await app.register(batchRoute);
  await app.register(keysRoute);
  await app.register(contactRoute);
  await app.register(adminRoute);

  // Stripe webhook needs its own encapsulated context for raw body parsing
  await app.register(webhooksRoute);

  // Connect to DB if configured
  const prisma = getPrisma();
  if (prisma) {
    await prisma.$connect();
    console.log("Connected to PostgreSQL");
  } else {
    console.log("No DATABASE_URL set — using in-memory key store");
  }

  await app.listen({ port: config.port, host: config.host });
  console.log(`ChronoShield API running at http://localhost:${config.port}`);
  console.log(`API docs at http://localhost:${config.port}/docs`);
}

// Graceful shutdown
async function shutdown(signal: string) {
  console.log(`Received ${signal}, shutting down gracefully...`);
  await app.close();
  await disconnectPrisma();
  process.exit(0);
}
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

process.on("uncaughtException", (err) => {
  console.error("Uncaught exception:", err);
  captureException(err, { source: "uncaughtException" });
});
process.on("unhandledRejection", (reason) => {
  console.error("Unhandled rejection:", reason);
  captureException(reason, { source: "unhandledRejection" });
});

start().catch((err) => {
  console.error("Failed to start server:", err);
  captureException(err, { source: "startup" });
  process.exit(1);
});

export { app };
