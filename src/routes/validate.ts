import { FastifyInstance } from "fastify";
import { ValidateSchema } from "../schemas/datetime.schema";
import { validateDateTime } from "../services/validation.service";

export async function validateRoute(app: FastifyInstance) {
  app.post(
    "/v1/datetime/validate",
    {
      schema: {
        description: "Validate a local datetime in a given timezone, detecting DST gaps and overlaps",
        tags: ["datetime"],
        body: {
          type: "object",
          required: ["local_datetime", "time_zone"],
          properties: {
            local_datetime: { type: "string", description: "ISO 8601 local datetime" },
            time_zone: { type: "string", description: "IANA timezone identifier" },
          },
        },
        response: {
          200: {
            type: "object",
            properties: {
              status: { type: "string", enum: ["valid", "invalid", "ambiguous"] },
              reason_code: { type: "string" },
              message: { type: "string" },
              suggested_fixes: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    strategy: { type: "string" },
                    local_datetime: { type: "string" },
                  },
                },
              },
              possible_instants: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    offset: { type: "string" },
                    instant_utc: { type: "string" },
                  },
                },
              },
            },
          },
          400: {
            type: "object",
            properties: {
              error: { type: "string" },
              details: { type: "array" },
            },
          },
        },
      },
    },
    async (request, reply) => {
      const parsed = ValidateSchema.safeParse(request.body);
      if (!parsed.success) {
        return (reply as any).code(400).send({
          error: "Validation failed",
          code: "VALIDATION_FAILED",
          message: "Request body failed schema validation.",
          details: parsed.error.issues,
        });
      }

      const { local_datetime, time_zone } = parsed.data;
      const result = validateDateTime(local_datetime, time_zone);
      return reply.send(result);
    }
  );
}
