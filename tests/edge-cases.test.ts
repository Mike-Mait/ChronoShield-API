import { describe, it, expect } from "vitest";
import { validateDateTime } from "../src/services/validation.service";
import { resolveDateTime } from "../src/services/resolution.service";
import { convertTime } from "../src/services/conversion.service";
import { DateTimeStatus, ReasonCode } from "../src/types/enums";

/**
 * Adversarial edge-case tests covering unusual DST regimes,
 * non-hour offsets, and other temporal quirks that cause bugs
 * in naive implementations.
 */

describe("Edge Cases: Unusual DST Regimes", () => {
  describe("Australia/Lord_Howe — 30-minute DST shift", () => {
    // Lord Howe Island shifts by only 30 minutes: UTC+10:30 (standard) to UTC+11 (DST)
    // DST ends first Sunday in April (fall-back): clocks go from 2:00 AM back to 1:30 AM
    // DST starts first Sunday in October (spring-forward): clocks go from 2:00 AM to 2:30 AM

    it("detects 30-minute DST gap on spring-forward", () => {
      // October 2026: first Sunday is Oct 4
      // Clocks jump from 2:00 AM to 2:30 AM — so 2:15 AM doesn't exist
      const result = validateDateTime("2026-10-04T02:15:00", "Australia/Lord_Howe");
      expect(result.status).toBe(DateTimeStatus.INVALID);
      expect(result.reason_code).toBe(ReasonCode.DST_GAP);
    });

    it("validates time just after Lord Howe spring-forward gap", () => {
      const result = validateDateTime("2026-10-04T02:30:00", "Australia/Lord_Howe");
      expect(result.status).toBe(DateTimeStatus.VALID);
    });

    it("detects 30-minute overlap on fall-back", () => {
      // April 2026: first Sunday is Apr 5
      // Clocks go from 2:00 AM back to 1:30 AM — so 1:45 AM happens twice
      const result = validateDateTime("2026-04-05T01:45:00", "Australia/Lord_Howe");
      expect(result.status).toBe(DateTimeStatus.AMBIGUOUS);
      expect(result.reason_code).toBe(ReasonCode.DST_OVERLAP);
    });
  });

  describe("Asia/Kathmandu — UTC+5:45 (non-hour, non-half-hour offset)", () => {
    // Nepal is UTC+5:45 year-round — no DST, just an unusual offset

    it("validates normal time in 45-minute offset zone", () => {
      const result = validateDateTime("2026-06-15T12:00:00", "Asia/Kathmandu");
      expect(result.status).toBe(DateTimeStatus.VALID);
    });

    it("converts UTC to Nepal correctly (5:45 offset)", () => {
      const result = convertTime("2026-06-15T00:00:00Z", "Asia/Kathmandu");
      expect(result.local_datetime).toBe("2026-06-15T05:45:00");
      expect(result.offset).toBe("+05:45");
    });

    it("resolves Nepal time to correct UTC instant", () => {
      const result = resolveDateTime("2026-06-15T12:00:00", "Asia/Kathmandu", {
        ambiguous: "earlier",
        invalid: "next_valid_time",
      });
      expect(result.instant_utc).toBe("2026-06-15T06:15:00.000Z");
      expect(result.offset).toBe("+05:45");
    });
  });

  describe("Pacific/Chatham — UTC+12:45 with DST (most extreme offset)", () => {
    // Chatham Islands: UTC+12:45 (standard) / UTC+13:45 (DST)
    // DST starts last Sunday of September, ends first Sunday of April

    it("validates normal time in Chatham", () => {
      const result = validateDateTime("2026-06-15T12:00:00", "Pacific/Chatham");
      expect(result.status).toBe(DateTimeStatus.VALID);
    });

    it("converts UTC to Chatham correctly during standard time", () => {
      // June = standard time (UTC+12:45)
      const result = convertTime("2026-06-15T00:00:00Z", "Pacific/Chatham");
      expect(result.local_datetime).toBe("2026-06-15T12:45:00");
      expect(result.offset).toBe("+12:45");
    });

    it("converts UTC to Chatham correctly during DST", () => {
      // December = DST (UTC+13:45)
      const result = convertTime("2026-12-15T00:00:00Z", "Pacific/Chatham");
      expect(result.local_datetime).toBe("2026-12-15T13:45:00");
      expect(result.offset).toBe("+13:45");
    });
  });

  describe("Asia/Tehran — Iran (irregular DST)", () => {
    // Iran uses UTC+3:30 (standard) / UTC+4:30 (DST)
    // DST starts March 21/22, ends September 21/22

    it("validates normal time in Tehran", () => {
      const result = validateDateTime("2026-07-15T12:00:00", "Asia/Tehran");
      expect(result.status).toBe(DateTimeStatus.VALID);
    });

    it("converts UTC to Tehran correctly with 3:30 offset", () => {
      // January = standard time (UTC+3:30)
      const result = convertTime("2026-01-15T00:00:00Z", "Asia/Tehran");
      expect(result.local_datetime).toBe("2026-01-15T03:30:00");
      expect(result.offset).toBe("+03:30");
    });
  });

  describe("Pacific/Apia — Samoa (jumped across the date line in 2011)", () => {
    // Samoa is UTC+13 / UTC+14 (DST) — one of the most forward timezones

    it("handles extreme positive offset correctly", () => {
      const result = convertTime("2026-06-15T00:00:00Z", "Pacific/Apia");
      expect(result.local_datetime).toBe("2026-06-15T13:00:00");
      expect(result.offset).toBe("+13:00");
    });
  });

  describe("UTC and fixed-offset edge cases", () => {
    it("validates time in UTC (no DST ever)", () => {
      const result = validateDateTime("2026-03-08T02:30:00", "UTC");
      expect(result.status).toBe(DateTimeStatus.VALID);
    });

    it("validates time in Etc/GMT+12 (extreme negative)", () => {
      const result = validateDateTime("2026-06-15T12:00:00", "Etc/GMT+12");
      expect(result.status).toBe(DateTimeStatus.VALID);
    });

    it("converts correctly across the date line", () => {
      // Midnight UTC, what time is it in Etc/GMT+12 (UTC-12)?
      const result = convertTime("2026-06-15T00:00:00Z", "Etc/GMT+12");
      expect(result.local_datetime).toBe("2026-06-14T12:00:00");
      expect(result.offset).toBe("-12:00");
    });
  });

  describe("Temporal boundary conditions", () => {
    it("handles midnight on DST transition day", () => {
      // Midnight is before the 2 AM gap, so it should be valid
      const result = validateDateTime("2026-03-08T00:00:00", "America/New_York");
      expect(result.status).toBe(DateTimeStatus.VALID);
    });

    it("handles 1:59:59 AM just before DST gap", () => {
      const result = validateDateTime("2026-03-08T01:59:00", "America/New_York");
      expect(result.status).toBe(DateTimeStatus.VALID);
    });

    it("handles 3:00 AM just after DST gap", () => {
      const result = validateDateTime("2026-03-08T03:00:00", "America/New_York");
      expect(result.status).toBe(DateTimeStatus.VALID);
    });

    it("handles New Year's midnight across all major zones", () => {
      const zones = [
        "America/New_York", "Europe/London", "Asia/Tokyo",
        "Australia/Sydney", "Pacific/Auckland",
      ];
      for (const zone of zones) {
        const result = validateDateTime("2026-01-01T00:00:00", zone);
        expect(result.status).toBe(DateTimeStatus.VALID);
      }
    });
  });
});
