import { DateTime } from "luxon";
import { isValidTimezone, parseDateTimeInZone, getNextValidTime, getPreviousValidTime } from "../utils/timezone";
import { ValidationError } from "../utils/errors";

export interface ResolutionResult {
  instant_utc: string;
  offset: string;
}

export function resolveDateTime(
  localDatetime: string,
  timeZone: string,
  policy: { ambiguous: string; invalid: string }
): ResolutionResult {
  if (!isValidTimezone(timeZone)) {
    throw new ValidationError(`Invalid IANA timezone: ${timeZone}`, "INVALID_TIMEZONE");
  }

  const result = parseDateTimeInZone(localDatetime, timeZone);

  if (result.reason === "PARSE_ERROR") {
    throw new ValidationError("Could not parse the provided datetime string.");
  }

  const formatOffset = (minutes: number) => {
    const sign = minutes >= 0 ? "+" : "-";
    const abs = Math.abs(minutes);
    const h = String(Math.floor(abs / 60)).padStart(2, "0");
    const m = String(abs % 60).padStart(2, "0");
    return `${sign}${h}:${m}`;
  };

  // Handle DST gap (invalid time)
  if (result.reason === "DST_GAP") {
    if (policy.invalid === "reject") {
      throw new ValidationError(
        "This time does not exist due to DST transition and policy is set to reject.",
        "DST_GAP"
      );
    }

    let resolved: DateTime;
    if (policy.invalid === "previous_valid_time") {
      resolved = getPreviousValidTime(localDatetime, timeZone);
    } else {
      // next_valid_time (default)
      resolved = getNextValidTime(localDatetime, timeZone);
    }

    return {
      instant_utc: resolved.toUTC().toISO()!,
      offset: formatOffset(resolved.offset),
    };
  }

  // Handle DST overlap (ambiguous time)
  if (result.reason === "DST_OVERLAP" && result.ambiguous) {
    if (policy.ambiguous === "reject") {
      throw new ValidationError(
        "This time is ambiguous due to DST transition and policy is set to reject.",
        "DST_OVERLAP"
      );
    }

    if (policy.ambiguous === "later") {
      return {
        instant_utc: result.laterUTC!.toISO()!,
        offset: formatOffset(result.laterOffset!),
      };
    }

    // earlier (default)
    return {
      instant_utc: result.earlierUTC!.toISO()!,
      offset: formatOffset(result.earlierOffset!),
    };
  }

  // Valid, unambiguous time
  const dt = DateTime.fromISO(localDatetime, { zone: timeZone });
  return {
    instant_utc: dt.toUTC().toISO()!,
    offset: formatOffset(dt.offset),
  };
}
