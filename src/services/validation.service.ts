import { DateTimeStatus, ReasonCode } from "../types/enums";
import { isValidTimezone, parseDateTimeInZone, getNextValidTime, getPreviousValidTime } from "../utils/timezone";

export interface ValidationResult {
  status: DateTimeStatus;
  reason_code?: ReasonCode;
  message?: string;
  suggested_fixes?: Array<{
    strategy: string;
    local_datetime: string;
  }>;
  possible_instants?: Array<{
    offset: string;
    instant_utc: string;
  }>;
}

export function validateDateTime(localDatetime: string, timeZone: string): ValidationResult {
  if (!isValidTimezone(timeZone)) {
    return {
      status: DateTimeStatus.INVALID,
      reason_code: ReasonCode.INVALID_TIMEZONE,
      message: `Invalid IANA timezone: ${timeZone}`,
    };
  }

  const result = parseDateTimeInZone(localDatetime, timeZone);

  if (result.reason === "PARSE_ERROR") {
    return {
      status: DateTimeStatus.INVALID,
      message: "Could not parse the provided datetime string.",
    };
  }

  if (result.reason === "DST_GAP") {
    const nextValid = getNextValidTime(localDatetime, timeZone);
    const prevValid = getPreviousValidTime(localDatetime, timeZone);

    return {
      status: DateTimeStatus.INVALID,
      reason_code: ReasonCode.DST_GAP,
      message: "This time does not exist due to DST transition.",
      suggested_fixes: [
        {
          strategy: "next_valid_time",
          local_datetime: nextValid.toFormat("yyyy-MM-dd'T'HH:mm:ss"),
        },
        {
          strategy: "previous_valid_time",
          local_datetime: prevValid.toFormat("yyyy-MM-dd'T'HH:mm:ss"),
        },
      ],
    };
  }

  if (result.reason === "DST_OVERLAP" && result.ambiguous) {
    const formatOffset = (minutes: number) => {
      const sign = minutes >= 0 ? "+" : "-";
      const abs = Math.abs(minutes);
      const h = String(Math.floor(abs / 60)).padStart(2, "0");
      const m = String(abs % 60).padStart(2, "0");
      return `${sign}${h}:${m}`;
    };

    return {
      status: DateTimeStatus.AMBIGUOUS,
      reason_code: ReasonCode.DST_OVERLAP,
      message: "This time is ambiguous due to DST transition (fall-back).",
      possible_instants: [
        {
          offset: formatOffset(result.earlierOffset!),
          instant_utc: result.earlierUTC!.toISO()!,
        },
        {
          offset: formatOffset(result.laterOffset!),
          instant_utc: result.laterUTC!.toISO()!,
        },
      ],
    };
  }

  return {
    status: DateTimeStatus.VALID,
    message: "The provided datetime is valid in the given timezone.",
  };
}
