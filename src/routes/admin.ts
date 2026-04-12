import { FastifyInstance } from "fastify";
import { config } from "../config/env";
import { getPrisma } from "../db/client";

function isAdminAuthorized(request: any): boolean {
  const apiKey = request.headers["x-api-key"] as string | undefined;
  return !!(config.apiKey && apiKey === config.apiKey);
}

export async function adminRoute(app: FastifyInstance) {
  // Revoke (deactivate) an API key by email
  app.post(
    "/api/admin/keys/revoke",
    { schema: { hide: true } },
    async (request, reply) => {
      if (!isAdminAuthorized(request)) {
        return reply.code(403).send({
          error: "Forbidden",
          code: "FORBIDDEN",
          message: "Admin access required.",
        });
      }

      const { email } = request.body as { email?: string };
      if (!email) {
        return reply.code(400).send({
          error: "Validation failed",
          code: "VALIDATION_FAILED",
          message: "Email is required.",
        });
      }

      const prisma = getPrisma();
      if (!prisma) {
        return reply.code(503).send({
          error: "Service unavailable",
          code: "DB_NOT_CONFIGURED",
          message: "Database not configured.",
        });
      }

      try {
        const record = await prisma.apiKey.findUnique({ where: { email } });
        if (!record) {
          return reply.code(404).send({
            error: "Not found",
            code: "KEY_NOT_FOUND",
            message: "No API key found for this email.",
          });
        }

        if (!record.active) {
          return reply.send({
            email,
            active: false,
            message: "Key is already revoked.",
          });
        }

        await prisma.apiKey.update({
          where: { email },
          data: { active: false },
        });

        request.log.info({ email, requestId: request.id }, "API key revoked by admin");
        return reply.send({
          email,
          active: false,
          message: "API key has been revoked.",
        });
      } catch (err) {
        request.log.error(err, "Failed to revoke API key");
        return reply.code(500).send({
          error: "Internal error",
          code: "INTERNAL_ERROR",
          message: "Failed to revoke key.",
        });
      }
    }
  );

  // Reactivate an API key by email
  app.post(
    "/api/admin/keys/activate",
    { schema: { hide: true } },
    async (request, reply) => {
      if (!isAdminAuthorized(request)) {
        return reply.code(403).send({
          error: "Forbidden",
          code: "FORBIDDEN",
          message: "Admin access required.",
        });
      }

      const { email } = request.body as { email?: string };
      if (!email) {
        return reply.code(400).send({
          error: "Validation failed",
          code: "VALIDATION_FAILED",
          message: "Email is required.",
        });
      }

      const prisma = getPrisma();
      if (!prisma) {
        return reply.code(503).send({
          error: "Service unavailable",
          code: "DB_NOT_CONFIGURED",
          message: "Database not configured.",
        });
      }

      try {
        const record = await prisma.apiKey.findUnique({ where: { email } });
        if (!record) {
          return reply.code(404).send({
            error: "Not found",
            code: "KEY_NOT_FOUND",
            message: "No API key found for this email.",
          });
        }

        if (record.active) {
          return reply.send({
            email,
            active: true,
            message: "Key is already active.",
          });
        }

        await prisma.apiKey.update({
          where: { email },
          data: { active: true },
        });

        request.log.info({ email, requestId: request.id }, "API key activated by admin");
        return reply.send({
          email,
          active: true,
          message: "API key has been reactivated.",
        });
      } catch (err) {
        request.log.error(err, "Failed to activate API key");
        return reply.code(500).send({
          error: "Internal error",
          code: "INTERNAL_ERROR",
          message: "Failed to activate key.",
        });
      }
    }
  );

  // List all API keys (admin overview)
  app.get(
    "/api/admin/keys",
    { schema: { hide: true } },
    async (request, reply) => {
      if (!isAdminAuthorized(request)) {
        return reply.code(403).send({
          error: "Forbidden",
          code: "FORBIDDEN",
          message: "Admin access required.",
        });
      }

      const prisma = getPrisma();
      if (!prisma) {
        return reply.code(503).send({
          error: "Service unavailable",
          code: "DB_NOT_CONFIGURED",
          message: "Database not configured.",
        });
      }

      try {
        const keys = await prisma.apiKey.findMany({
          select: {
            id: true,
            email: true,
            tier: true,
            active: true,
            requestsUsed: true,
            requestsLimit: true,
            stripeCustomerId: true,
            resetAt: true,
            createdAt: true,
          },
          orderBy: { createdAt: "desc" },
        });

        return reply.send({ count: keys.length, keys });
      } catch (err) {
        request.log.error(err, "Failed to list API keys");
        return reply.code(500).send({
          error: "Internal error",
          code: "INTERNAL_ERROR",
          message: "Failed to list keys.",
        });
      }
    }
  );
}
