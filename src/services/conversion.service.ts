import { DateTime } from "luxon";
import { isValidTimezone } from "../utils/timezone";
import { ValidationError } from "../utils/errors";

export interface ConversionResult {
  local_datetime: string;
  offset: string;
  time_zone: string;
}

export function convertTime(instantUtc: string, targetTimeZone: string): ConversionResult {
  if (!isValidTimezone(targetTimeZone)) {
    throw new ValidationError(`Invalid IANA timezone: ${targetTimeZone}`, "INVALID_TIMEZONE");
  }

  const utc = DateTime.fromISO(instantUtc, { zone: "UTC" });
  if (!utc.isValid) {
    throw new ValidationError("Could not parse the provided UTC datetime string.");
  }

  const local = utc.setZone(targetTimeZone);

  const formatOffset = (minutes: number) => {
    const sign = minutes >= 0 ? "+" : "-";
    const abs = Math.abs(minutes);
    const h = String(Math.floor(abs / 60)).padStart(2, "0");
    const m = String(abs % 60).padStart(2, "0");
    return `${sign}${h}:${m}`;
  };

  return {
    local_datetime: local.toFormat("yyyy-MM-dd'T'HH:mm:ss"),
    offset: formatOffset(local.offset),
    time_zone: targetTimeZone,
  };
}
