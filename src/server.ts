import path from "path";
import fs from "fs";
import Fastify from "fastify";
import fastifySwagger from "@fastify/swagger";
import fastifySwaggerUi from "@fastify/swagger-ui";
import { config } from "./config/env";
import { validateRoute } from "./routes/validate";
import { resolveRoute } from "./routes/resolve";
import { convertRoute } from "./routes/convert";
import { keysRoute } from "./routes/keys";
import { batchRoute } from "./routes/batch";
import { webhooksRoute } from "./routes/webhooks";
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
});

// Paths that skip API key auth
const publicPaths = ["/health", "/docs", "/api/keys", "/api/webhooks", "/docs/playground"];

// API key auth hook
app.addHook("onRequest", async (request, reply) => {
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
    return reply.code(401).send({ error: "Unauthorized: invalid or missing API key" });
  }

  // Check master key from environment
  if (config.apiKey && apiKey === config.apiKey) {
    return;
  }

  // Check dynamically generated keys from keyStore (DB + memory)
  const keyEntry = await lookupKeyAsync(apiKey);
  if (!keyEntry) {
    return reply.code(401).send({ error: "Unauthorized: invalid or missing API key" });
  }

  // Enforce rate limits
  if (keyEntry.requestsUsed >= keyEntry.requestsLimit) {
    return reply.code(429).send({
      error: "Rate limit exceeded",
      limit: keyEntry.requestsLimit,
      tier: keyEntry.tier,
      message: keyEntry.tier === "free"
        ? "Upgrade to Pro for 100,000 requests/month."
        : "Contact us for enterprise limits.",
    });
  }

  // Increment usage
  incrementUsage(apiKey);
});

// API version + rate-limit headers
app.addHook("onSend", async (request, reply) => {
  reply.header("X-API-Version", "1.0.0");
  reply.header("X-Powered-By", "ChronoGuard");
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
});

// Global error handler
app.setErrorHandler(async (error, request, reply) => {
  if (error instanceof AppError) {
    return reply.code(error.statusCode).send({
      error: error.message,
      code: error.code,
    });
  }

  request.log.error(error);
  return reply.code(500).send({ error: "Internal server error" });
});

async function start() {
  // Swagger / OpenAPI
  await app.register(fastifySwagger, {
    openapi: {
      openapi: "3.1.0",
      info: {
        title: "ChronoGuard API",
        description: "DST-aware datetime validation, resolution, and conversion API",
        version: "1.0.0",
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
  });

  // Health check
  app.get("/health", { schema: { hide: true } }, async () => ({ status: "ok" }));

  // Custom docs page
  app.get("/docs", { schema: { hide: true } }, async (_request, reply) => {
    const htmlPath = path.join(__dirname, "public", "docs.html");
    const html = fs.readFileSync(htmlPath, "utf-8");
    return reply.type("text/html").send(html);
  });

  // Landing page
  app.get("/", { schema: { hide: true } }, async (_request, reply) => {
    const htmlPath = path.join(__dirname, "public", "index.html");
    const html = fs.readFileSync(htmlPath, "utf-8");
    return reply.type("text/html").send(html);
  });

  // API routes
  await app.register(validateRoute);
  await app.register(resolveRoute);
  await app.register(convertRoute);
  await app.register(batchRoute);
  await app.register(keysRoute);

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
  console.log(`ChronoGuard API running at http://localhost:${config.port}`);
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

start().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});

export { app };
