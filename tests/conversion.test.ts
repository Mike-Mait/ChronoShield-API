import { describe, it, expect } from "vitest";
import { convertTime } from "../src/services/conversion.service";

describe("Conversion Service", () => {
  it("converts UTC to Europe/London in summer (BST)", () => {
    const result = convertTime("2026-06-15T15:00:00Z", "Europe/London");
    expect(result.local_datetime).toBe("2026-06-15T16:00:00");
    expect(result.offset).toBe("+01:00");
    expect(result.time_zone).toBe("Europe/London");
  });

  it("converts UTC to Europe/London in winter (GMT)", () => {
    const result = convertTime("2026-01-15T15:00:00Z", "Europe/London");
    expect(result.local_datetime).toBe("2026-01-15T15:00:00");
    expect(result.offset).toBe("+00:00");
    expect(result.time_zone).toBe("Europe/London");
  });

  it("converts UTC to America/New_York in summer (EDT)", () => {
    const result = convertTime("2026-06-15T16:00:00Z", "America/New_York");
    expect(result.local_datetime).toBe("2026-06-15T12:00:00");
    expect(result.offset).toBe("-04:00");
  });

  it("converts UTC to America/New_York in winter (EST)", () => {
    const result = convertTime("2026-01-15T17:00:00Z", "America/New_York");
    expect(result.local_datetime).toBe("2026-01-15T12:00:00");
    expect(result.offset).toBe("-05:00");
  });

  it("converts UTC to Asia/Tokyo (no DST)", () => {
    const result = convertTime("2026-06-15T00:00:00Z", "Asia/Tokyo");
    expect(result.local_datetime).toBe("2026-06-15T09:00:00");
    expect(result.offset).toBe("+09:00");
  });

  it("converts midnight UTC to Australia/Sydney", () => {
    // In January, Sydney is AEDT (UTC+11)
    const result = convertTime("2026-01-01T00:00:00Z", "Australia/Sydney");
    expect(result.local_datetime).toBe("2026-01-01T11:00:00");
    expect(result.offset).toBe("+11:00");
  });

  it("throws for invalid timezone", () => {
    expect(() => convertTime("2026-06-15T15:00:00Z", "Fake/Zone")).toThrow(
      "Invalid IANA timezone"
    );
  });

  it("throws for invalid UTC datetime", () => {
    expect(() => convertTime("not-a-date", "America/New_York")).toThrow();
  });
});
