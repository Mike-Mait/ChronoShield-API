import { DateTime, IANAZone } from "luxon";

export function isValidTimezone(zone: string): boolean {
  return IANAZone.isValidZone(zone);
}

/**
 * Parse the hour and minute from an ISO local datetime string
 * without relying on Luxon (which auto-corrects gap times).
 */
function parseRawHourMinute(localDatetime: string): { hour: number; minute: number } | null {
  const match = localDatetime.match(/T(\d{2}):(\d{2})/);
  if (!match) return null;
  return { hour: parseInt(match[1], 10), minute: parseInt(match[2], 10) };
}

/**
 * Detect whether a local datetime falls in a DST gap (invalid)
 * or DST overlap (ambiguous) for a given timezone.
 *
 * Gap detection: Parse raw hour/minute from input string. Parse with Luxon
 * in the zone (Luxon auto-resolves gaps forward). If Luxon's resolved
 * hour/minute differs from the raw input, it's a gap.
 *
 * Overlap detection: Check offsets around the time. If they differ,
 * the time is near a DST transition and may be ambiguous.
 */
export function parseDateTimeInZone(localDatetime: string, zone: string) {
  const dt = DateTime.fromISO(localDatetime, { zone });

  if (!dt.isValid) {
    return { valid: false, dt: null, reason: "PARSE_ERROR" as const };
  }

  const raw = parseRawHourMinute(localDatetime);
  if (!raw) {
    return { valid: false, dt: null, reason: "PARSE_ERROR" as const };
  }

  // Luxon auto-resolves gap times forward. Compare what we asked for vs what we got.
  if (dt.hour !== raw.hour || dt.minute !== raw.minute) {
    // DST gap: the requested time doesn't exist
    return { valid: false, dt, reason: "DST_GAP" as const, raw };
  }

  // Check for DST overlap by looking at offsets around this time
  const before = dt.minus({ hours: 1 });
  const after = dt.plus({ hours: 1 });

  if (before.offset !== after.offset) {
    // Near a transition. Determine if this specific wall-clock time is ambiguous.
    // For an overlap (fall-back), the same wall time occurs at two different offsets.
    const offset1 = before.offset; // offset before transition
    const offset2 = after.offset;  // offset after transition

    // Build two candidate UTC instants by applying each offset
    // dt is already parsed with one of the offsets; we compute the other
    const dtOffset = dt.offset;
    const otherOffset = dtOffset === offset1 ? offset2 : offset1;

    // The UTC millis if we used the other offset
    const otherUTCMillis = dt.toMillis() + (dtOffset - otherOffset) * 60 * 1000;
    const otherUTC = DateTime.fromMillis(otherUTCMillis, { zone: "UTC" });
    const otherLocal = otherUTC.setZone(zone);

    // Check if the other interpretation also maps to the same wall time
    if (otherLocal.hour === raw.hour && otherLocal.minute === raw.minute) {
      // Both offsets produce the same wall time = ambiguous
      const earlierOffset = Math.max(offset1, offset2);
      const laterOffset = Math.min(offset1, offset2);

      // Earlier UTC = larger offset (e.g. EDT -4 is "earlier" occurrence before fallback)
      const earlierUTC = dtOffset === earlierOffset
        ? dt.toUTC()
        : otherUTC;
      const laterUTC = dtOffset === laterOffset
        ? dt.toUTC()
        : otherUTC;

      return {
        valid: true,
        ambiguous: true,
        dt,
        reason: "DST_OVERLAP" as const,
        earlierOffset,
        laterOffset,
        earlierUTC,
        laterUTC,
      };
    }
  }

  return { valid: true, ambiguous: false, dt, reason: null };
}

/**
 * Get the next valid time after a DST gap.
 * For a spring-forward gap (e.g. 2:00->3:00), the next valid time
 * for any time in the gap (2:00-2:59) is the first post-gap moment (3:00).
 */
export function getNextValidTime(localDatetime: string, zone: string): DateTime {
  const raw = parseRawHourMinute(localDatetime);
  const dt = DateTime.fromISO(localDatetime, { zone });

  if (!raw) return dt;

  // Luxon resolved the gap time forward. The gap size is the difference
  // between what we asked for and what Luxon gave us.
  // The next valid time is dt with minute/second zeroed out if the gap
  // pushed us forward, i.e., the first moment of the new offset.
  // E.g., asked for 2:30, Luxon gave 3:30. Next valid = 3:00.
  const dateStr = localDatetime.split("T")[0];
  const nextValidStr = `${dateStr}T${String(dt.hour).padStart(2, "0")}:00:00`;
  return DateTime.fromISO(nextValidStr, { zone });
}

/**
 * Get the previous valid time before a DST gap.
 * This is the instant just before the gap starts.
 */
export function getPreviousValidTime(localDatetime: string, zone: string): DateTime {
  const raw = parseRawHourMinute(localDatetime);
  const dt = DateTime.fromISO(localDatetime, { zone });

  if (!raw) return dt;

  // Luxon resolved forward. The gap started at the raw hour.
  // E.g., for spring-forward at 2:00, gap is 2:00-2:59. Previous valid = 1:59:59.
  // Build the gap start: same date, the raw hour, minute 0
  const gapStart = dt.set({ hour: raw.hour, minute: 0, second: 0, millisecond: 0 });

  // But gapStart with the raw hour might also get auto-resolved by Luxon.
  // Instead, construct the time just before the gap by going back from Luxon's resolved time.
  // The gap size = (dt.hour - raw.hour) * 60 + (dt.minute - raw.minute) minutes
  // But we know the gap start is at the raw hour:00 in pre-transition offset.

  // Simpler approach: find the last second before the transition
  // The transition happens at raw.hour:00. The previous valid time is raw.hour-1:59:59
  // in the pre-transition offset.
  const dateStr = localDatetime.split("T")[0];
  const prevHour = raw.hour - 1;
  const prevTimeStr = `${dateStr}T${String(prevHour).padStart(2, "0")}:59:59`;
  const prev = DateTime.fromISO(prevTimeStr, { zone });

  return prev;
}
