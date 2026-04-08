import { z } from "zod";

export const ValidateSchema = z.object({
  local_datetime: z.string().max(30).regex(
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/,
    "Must be ISO 8601 local datetime (e.g. 2026-03-08T02:30:00)"
  ),
  time_zone: z.string().min(1, "time_zone is required").max(100),
});

export const ResolveSchema = z.object({
  local_datetime: z.string().max(30).regex(
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/,
    "Must be ISO 8601 local datetime (e.g. 2026-03-08T02:30:00)"
  ),
  time_zone: z.string().min(1, "time_zone is required").max(100),
  resolution_policy: z.object({
    ambiguous: z.enum(["earlier", "later", "reject"]).default("earlier"),
    invalid: z.enum(["next_valid_time", "previous_valid_time", "reject"]).default("next_valid_time"),
  }).default({ ambiguous: "earlier" as const, invalid: "next_valid_time" as const }),
});

export const ConvertSchema = z.object({
  instant_utc: z.string().max(30).regex(
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?Z$/,
    "Must be ISO 8601 UTC datetime (e.g. 2026-06-15T15:00:00Z)"
  ),
  target_time_zone: z.string().min(1, "target_time_zone is required").max(100),
});

export type ValidateInput = z.infer<typeof ValidateSchema>;
export type ResolveInput = z.infer<typeof ResolveSchema>;
export type ConvertInput = z.infer<typeof ConvertSchema>;
