import { FastifyInstance } from "fastify";
import { z } from "zod";
import { validateDateTime } from "../services/validation.service";
import { resolveDateTime } from "../services/resolution.service";
import { convertTime } from "../services/conversion.service";
import { AppError } from "../utils/errors";

const BatchItemSchema = z.discriminatedUnion("operation", [
  z.object({
    operation: z.literal("validate"),
    local_datetime: z.string().max(30).regex(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/,
      "Must be ISO 8601 local datetime"
    ),
    time_zone: z.string().min(1).max(100),
  }),
  z.object({
    operation: z.literal("resolve"),
    local_datetime: z.string().max(30).regex(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/,
      "Must be ISO 8601 local datetime"
    ),
    time_zone: z.string().min(1).max(100),
    resolution_policy: z.object({
      ambiguous: z.enum(["earlier", "later", "reject"]).default("earlier"),
      invalid: z.enum(["next_valid_time", "previous_valid_time", "reject"]).default("next_valid_time"),
    }).default({ ambiguous: "earlier" as const, invalid: "next_valid_time" as const }),
  }),
  z.object({
    operation: z.literal("convert"),
    instant_utc: z.string().max(30).regex(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?Z$/,
      "Must be ISO 8601 UTC datetime"
    ),
    target_time_zone: z.string().min(1).max(100),
  }),
]);

const BatchSchema = z.object({
  items: z.array(BatchItemSchema).min(1).max(100),
});

export async function batchRoute(app: FastifyInstance) {
  app.post(
    "/v1/datetime/batch",
    {
      schema: {
        description:
          "Process multiple datetime operations in a single request. Supports validate, resolve, and convert operations. Max 100 items per batch.",
        tags: ["datetime"],
        body: {
          type: "object",
          required: ["items"],
          properties: {
            items: {
              type: "array",
              maxItems: 100,
              items: {
                type: "object",
                required: ["operation"],
                properties: {
                  operation: {
                    type: "string",
                    enum: ["validate", "resolve", "convert"],
                  },
                  local_datetime: { type: "string" },
                  time_zone: { type: "string" },
                  instant_utc: { type: "string" },
                  target_time_zone: { type: "string" },
                  resolution_policy: {
                    type: "object",
                    properties: {
                      ambiguous: { type: "string", enum: ["earlier", "later", "reject"] },
                      invalid: { type: "string", enum: ["next_valid_time", "previous_valid_time", "reject"] },
                    },
                  },
                },
              },
            },
          },
        },
        response: {
          200: {
            type: "object",
            properties: {
              results: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    index: { type: "number" },
                    operation: { type: "string" },
                    success: { type: "boolean" },
                    data: { type: "object", additionalProperties: true },
                    error: {
                      type: "object",
                      properties: {
                        message: { type: "string" },
                        code: { type: "string" },
                      },
                    },
                  },
                },
              },
              total: { type: "number" },
              succeeded: { type: "number" },
              failed: { type: "number" },
            },
          },
        },
      },
    },
    async (request, reply) => {
      const parsed = BatchSchema.safeParse(request.body);
      if (!parsed.success) {
        return (reply as any).code(400).send({
          error: "Validation failed",
          code: "VALIDATION_FAILED",
          message: "Request body failed schema validation.",
          details: parsed.error.issues,
        });
      }

      const { items } = parsed.data;
      let succeeded = 0;
      let failed = 0;

      const results = items.map((item, index) => {
        try {
          switch (item.operation) {
            case "validate": {
              const result = validateDateTime(item.local_datetime, item.time_zone);
              succeeded++;
              return { index, operation: "validate", success: true, data: result };
            }
            case "resolve": {
              const result = resolveDateTime(
                item.local_datetime,
                item.time_zone,
                item.resolution_policy
              );
              succeeded++;
              return { index, operation: "resolve", success: true, data: result };
            }
            case "convert": {
              const result = convertTime(item.instant_utc, item.target_time_zone);
              succeeded++;
              return { index, operation: "convert", success: true, data: result };
            }
          }
        } catch (err: any) {
          failed++;
          return {
            index,
            operation: item.operation,
            success: false,
            error: {
              message: err.message,
              code: err instanceof AppError ? err.code : undefined,
            },
          };
        }
      });

      return reply.send({
        results,
        total: items.length,
        succeeded,
        failed,
      });
    }
  );
}
