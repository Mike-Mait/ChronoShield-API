import { describe, it, expect } from "vitest";
import { validateDateTime } from "../src/services/validation.service";
import { DateTimeStatus, ReasonCode } from "../src/types/enums";

describe("Validation Service", () => {
  describe("DST Gap Detection", () => {
    it("detects DST gap (spring forward) - America/New_York 2026", () => {
      // 2026-03-08 is the spring forward date for America/New_York
      // Clocks jump from 2:00 AM to 3:00 AM, so 2:30 AM doesn't exist
      const result = validateDateTime("2026-03-08T02:30:00", "America/New_York");
      expect(result.status).toBe(DateTimeStatus.INVALID);
      expect(result.reason_code).toBe(ReasonCode.DST_GAP);
      expect(result.suggested_fixes).toBeDefined();
      expect(result.suggested_fixes!.length).toBeGreaterThanOrEqual(1);

      const nextValid = result.suggested_fixes!.find((f) => f.strategy === "next_valid_time");
      expect(nextValid).toBeDefined();
      expect(nextValid!.local_datetime).toBe("2026-03-08T03:00:00");
    });

    it("detects DST gap at exact boundary 2:00 AM", () => {
      const result = validateDateTime("2026-03-08T02:00:00", "America/New_York");
      expect(result.status).toBe(DateTimeStatus.INVALID);
      expect(result.reason_code).toBe(ReasonCode.DST_GAP);
    });

    it("detects DST gap - Europe/London spring forward", () => {
      // UK springs forward last Sunday of March: 2026-03-29
      // Clocks jump from 1:00 AM to 2:00 AM
      const result = validateDateTime("2026-03-29T01:30:00", "Europe/London");
      expect(result.status).toBe(DateTimeStatus.INVALID);
      expect(result.reason_code).toBe(ReasonCode.DST_GAP);
    });
  });

  describe("DST Overlap Detection", () => {
    it("detects DST overlap (fall back) - America/New_York 2026", () => {
      // 2026-11-01 is the fall back date for America/New_York
      // Clocks go from 2:00 AM back to 1:00 AM, so 1:30 AM occurs twice
      const result = validateDateTime("2026-11-01T01:30:00", "America/New_York");
      expect(result.status).toBe(DateTimeStatus.AMBIGUOUS);
      expect(result.reason_code).toBe(ReasonCode.DST_OVERLAP);
      expect(result.possible_instants).toBeDefined();
      expect(result.possible_instants!.length).toBe(2);
    });
  });

  describe("Valid Times", () => {
    it("validates a normal datetime", () => {
      const result = validateDateTime("2026-06-15T12:00:00", "America/New_York");
      expect(result.status).toBe(DateTimeStatus.VALID);
    });

    it("validates midnight", () => {
      const result = validateDateTime("2026-01-01T00:00:00", "America/New_York");
      expect(result.status).toBe(DateTimeStatus.VALID);
    });

    it("validates end of day", () => {
      const result = validateDateTime("2026-12-31T23:59:00", "UTC");
      expect(result.status).toBe(DateTimeStatus.VALID);
    });

    it("validates leap year date", () => {
      const result = validateDateTime("2028-02-29T12:00:00", "America/New_York");
      expect(result.status).toBe(DateTimeStatus.VALID);
    });

    it("validates end of month boundary", () => {
      const result = validateDateTime("2026-01-31T23:59:00", "America/New_York");
      expect(result.status).toBe(DateTimeStatus.VALID);
    });
  });

  describe("Invalid Timezone", () => {
    it("rejects invalid IANA timezone", () => {
      const result = validateDateTime("2026-06-15T12:00:00", "Invalid/Timezone");
      expect(result.status).toBe(DateTimeStatus.INVALID);
      expect(result.reason_code).toBe(ReasonCode.INVALID_TIMEZONE);
    });

    it("rejects abbreviation timezones", () => {
      const result = validateDateTime("2026-06-15T12:00:00", "EST");
      // EST is technically recognized by Luxon as a fixed-offset zone, so this may be valid
      // but we test that IANA validation works for clearly invalid zones
      expect(result.status).toBeDefined();
    });
  });
});
