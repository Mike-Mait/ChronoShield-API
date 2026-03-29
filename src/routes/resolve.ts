import { FastifyInstance } from "fastify";
import { ResolveSchema } from "../schemas/datetime.schema";
import { resolveDateTime } from "../services/resolution.service";
import { AppError } from "../utils/errors";

export async function resolveRoute(app: FastifyInstance) {
  app.post(
    "/v1/datetime/resolve",
    {
      schema: {
        description: "Resolve an ambiguous or invalid local datetime to a UTC instant",
        tags: ["datetime"],
        body: {
          type: "object",
          required: ["local_datetime", "time_zone"],
          properties: {
            local_datetime: { type: "string", description: "ISO 8601 local datetime" },
            time_zone: { type: "string", description: "IANA timezone identifier" },
            resolution_policy: {
              type: "object",
              properties: {
                ambiguous: { type: "string", enum: ["earlier", "later", "reject"] },
                invalid: { type: "string", enum: ["next_valid_time", "previous_valid_time", "reject"] },
              },
            },
          },
        },
        response: {
          200: {
            type: "object",
            properties: {
              instant_utc: { type: "string" },
              offset: { type: "string" },
            },
          },
        },
      },
    },
    async (request, reply) => {
      const parsed = ResolveSchema.safeParse(request.body);
      if (!parsed.success) {
        return (reply as any).code(400).send({
          error: "Validation failed",
          details: parsed.error.issues,
        });
      }

      const { local_datetime, time_zone, resolution_policy } = parsed.data;

      try {
        const result = resolveDateTime(local_datetime, time_zone, resolution_policy);
        return reply.send(result);
      } catch (err) {
        if (err instanceof AppError) {
          return reply.code(err.statusCode as any).send({
            error: err.message,
            code: err.code,
          } as any);
        }
        throw err;
      }
    }
  );
}
