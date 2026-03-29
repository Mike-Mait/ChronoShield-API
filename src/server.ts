import Fastify from "fastify";
import fastifySwagger from "@fastify/swagger";
import fastifySwaggerUi from "@fastify/swagger-ui";
import { config } from "./config/env";
import { validateRoute } from "./routes/validate";
import { resolveRoute } from "./routes/resolve";
import { convertRoute } from "./routes/convert";
import { AppError } from "./utils/errors";

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

// API key auth hook
app.addHook("onRequest", async (request, reply) => {
  // Skip auth for health check and docs
  const skipPaths = ["/health", "/docs", "/docs/"];
  if (
    skipPaths.some((p) => request.url.startsWith(p)) ||
    request.url === "/" ||
    request.url.startsWith("/docs/")
  ) {
    return;
  }

  const apiKey = request.headers["x-api-key"];
  if (!config.apiKey) {
    return; // No key configured, skip auth
  }

  if (!apiKey || apiKey !== config.apiKey) {
    return reply.code(401).send({ error: "Unauthorized: invalid or missing API key" });
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
      servers: [{ url: `http://localhost:${config.port}` }],
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
    routePrefix: "/docs",
  });

  // Health check
  app.get("/health", { schema: { hide: true } }, async () => ({ status: "ok" }));

  // Routes
  await app.register(validateRoute);
  await app.register(resolveRoute);
  await app.register(convertRoute);

  await app.listen({ port: config.port, host: config.host });
  console.log(`ChronoGuard API running at http://localhost:${config.port}`);
  console.log(`API docs at http://localhost:${config.port}/docs`);
}

start().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});

export { app };
