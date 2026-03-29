export enum DateTimeStatus {
  VALID = "valid",
  INVALID = "invalid",
  AMBIGUOUS = "ambiguous",
}

export enum ReasonCode {
  DST_GAP = "DST_GAP",
  DST_OVERLAP = "DST_OVERLAP",
  INVALID_TIMEZONE = "INVALID_TIMEZONE",
}

export enum AmbiguousPolicy {
  EARLIER = "earlier",
  LATER = "later",
  REJECT = "reject",
}

export enum InvalidPolicy {
  NEXT_VALID = "next_valid_time",
  PREVIOUS_VALID = "previous_valid_time",
  REJECT = "reject",
}
