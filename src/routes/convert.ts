import { FastifyInstance } from "fastify";
import { ConvertSchema } from "../schemas/datetime.schema";
import { convertTime } from "../services/conversion.service";
import { AppError } from "../utils/errors";

export async function convertRoute(app: FastifyInstance) {
  app.post(
    "/v1/datetime/convert",
    {
      schema: {
        description: "Convert a UTC instant to a local datetime in a target timezone",
        tags: ["datetime"],
        body: {
          type: "object",
          required: ["instant_utc", "target_time_zone"],
          properties: {
            instant_utc: { type: "string", description: "ISO 8601 UTC datetime" },
            target_time_zone: { type: "string", description: "IANA timezone identifier" },
          },
        },
        response: {
          200: {
            type: "object",
            properties: {
              local_datetime: { type: "string" },
              offset: { type: "string" },
              time_zone: { type: "string" },
            },
          },
        },
      },
    },
    async (request, reply) => {
      const parsed = ConvertSchema.safeParse(request.body);
      if (!parsed.success) {
        return (reply as any).code(400).send({
          error: "Validation failed",
          details: parsed.error.issues,
        });
      }

      const { instant_utc, target_time_zone } = parsed.data;

      try {
        const result = convertTime(instant_utc, target_time_zone);
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
