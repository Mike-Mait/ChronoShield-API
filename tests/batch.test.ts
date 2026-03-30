import { describe, it, expect, beforeAll, afterAll } from "vitest";
import Fastify from "fastify";
import { batchRoute } from "../src/routes/batch";

describe("Batch Endpoint", () => {
  const app = Fastify();

  beforeAll(async () => {
    await app.register(batchRoute);
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it("processes mixed validate/resolve/convert operations", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/v1/datetime/batch",
      payload: {
        items: [
          {
            operation: "validate",
            local_datetime: "2026-03-08T02:30:00",
            time_zone: "America/New_York",
          },
          {
            operation: "resolve",
            local_datetime: "2026-11-01T01:30:00",
            time_zone: "America/New_York",
            resolution_policy: { ambiguous: "earlier" },
          },
          {
            operation: "convert",
            instant_utc: "2026-06-15T15:00:00Z",
            target_time_zone: "Europe/London",
          },
        ],
      },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.total).toBe(3);
    expect(body.succeeded).toBe(3);
    expect(body.failed).toBe(0);
    expect(body.results).toHaveLength(3);

    // Validate result
    expect(body.results[0].operation).toBe("validate");
    expect(body.results[0].success).toBe(true);
    expect(body.results[0].data.status).toBe("invalid");
    expect(body.results[0].data.reason_code).toBe("DST_GAP");

    // Resolve result
    expect(body.results[1].operation).toBe("resolve");
    expect(body.results[1].success).toBe(true);
    expect(body.results[1].data.instant_utc).toBe("2026-11-01T05:30:00.000Z");

    // Convert result
    expect(body.results[2].operation).toBe("convert");
    expect(body.results[2].success).toBe(true);
    expect(body.results[2].data.local_datetime).toBe("2026-06-15T16:00:00");
  });

  it("handles partial failures gracefully", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/v1/datetime/batch",
      payload: {
        items: [
          {
            operation: "validate",
            local_datetime: "2026-06-15T12:00:00",
            time_zone: "America/New_York",
          },
          {
            operation: "resolve",
            local_datetime: "2026-03-08T02:30:00",
            time_zone: "America/New_York",
            resolution_policy: { ambiguous: "earlier", invalid: "reject" },
          },
        ],
      },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.total).toBe(2);
    expect(body.succeeded).toBe(1);
    expect(body.failed).toBe(1);

    // First succeeds
    expect(body.results[0].success).toBe(true);
    expect(body.results[0].data.status).toBe("valid");

    // Second fails (reject policy on gap)
    expect(body.results[1].success).toBe(false);
    expect(body.results[1].error).toBeDefined();
  });

  it("rejects empty items array", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/v1/datetime/batch",
      payload: { items: [] },
    });

    expect(response.statusCode).toBe(400);
  });

  it("rejects batch exceeding 100 items", async () => {
    const items = Array.from({ length: 101 }, () => ({
      operation: "validate" as const,
      local_datetime: "2026-06-15T12:00:00",
      time_zone: "UTC",
    }));

    const response = await app.inject({
      method: "POST",
      url: "/v1/datetime/batch",
      payload: { items },
    });

    expect(response.statusCode).toBe(400);
  });

  it("processes all-validate batch correctly", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/v1/datetime/batch",
      payload: {
        items: [
          { operation: "validate", local_datetime: "2026-06-15T12:00:00", time_zone: "UTC" },
          { operation: "validate", local_datetime: "2026-03-08T02:30:00", time_zone: "America/New_York" },
          { operation: "validate", local_datetime: "2026-11-01T01:30:00", time_zone: "America/New_York" },
        ],
      },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.results[0].data.status).toBe("valid");
    expect(body.results[1].data.status).toBe("invalid");
    expect(body.results[2].data.status).toBe("ambiguous");
  });
});
