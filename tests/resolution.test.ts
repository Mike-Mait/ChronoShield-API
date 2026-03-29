import { describe, it, expect } from "vitest";
import { resolveDateTime } from "../src/services/resolution.service";

describe("Resolution Service", () => {
  const defaultPolicy = { ambiguous: "earlier", invalid: "next_valid_time" };

  describe("Normal Times", () => {
    it("resolves a normal datetime to UTC", () => {
      const result = resolveDateTime("2026-06-15T12:00:00", "America/New_York", defaultPolicy);
      expect(result.instant_utc).toBe("2026-06-15T16:00:00.000Z");
      expect(result.offset).toBe("-04:00");
    });
  });

  describe("DST Gap Resolution", () => {
    it("resolves DST gap with next_valid_time policy", () => {
      const result = resolveDateTime("2026-03-08T02:30:00", "America/New_York", {
        ambiguous: "earlier",
        invalid: "next_valid_time",
      });
      // Should resolve to 3:00 AM EDT (UTC-4), which is 07:00 UTC
      expect(result.instant_utc).toBe("2026-03-08T07:00:00.000Z");
    });

    it("rejects DST gap when policy is reject", () => {
      expect(() =>
        resolveDateTime("2026-03-08T02:30:00", "America/New_York", {
          ambiguous: "earlier",
          invalid: "reject",
        })
      ).toThrow();
    });
  });

  describe("DST Overlap Resolution", () => {
    it("resolves ambiguous time with earlier policy", () => {
      const result = resolveDateTime("2026-11-01T01:30:00", "America/New_York", {
        ambiguous: "earlier",
        invalid: "next_valid_time",
      });
      // Earlier = EDT (UTC-4), so 1:30 AM EDT = 05:30 UTC
      expect(result.instant_utc).toBe("2026-11-01T05:30:00.000Z");
      expect(result.offset).toBe("-04:00");
    });

    it("resolves ambiguous time with later policy", () => {
      const result = resolveDateTime("2026-11-01T01:30:00", "America/New_York", {
        ambiguous: "later",
        invalid: "next_valid_time",
      });
      // Later = EST (UTC-5), so 1:30 AM EST = 06:30 UTC
      expect(result.instant_utc).toBe("2026-11-01T06:30:00.000Z");
      expect(result.offset).toBe("-05:00");
    });

    it("rejects ambiguous time when policy is reject", () => {
      expect(() =>
        resolveDateTime("2026-11-01T01:30:00", "America/New_York", {
          ambiguous: "reject",
          invalid: "next_valid_time",
        })
      ).toThrow();
    });
  });

  describe("Invalid Timezone", () => {
    it("throws for invalid timezone", () => {
      expect(() =>
        resolveDateTime("2026-06-15T12:00:00", "Fake/Zone", defaultPolicy)
      ).toThrow("Invalid IANA timezone");
    });
  });
});
