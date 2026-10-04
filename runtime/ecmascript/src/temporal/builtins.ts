import { Instant } from "./instant-object.ts";
import { NtsDate } from "../date/builtins.ts";
export { Instant } from "./instant-object.ts";
export { Duration } from "./duration.ts";
export { PlainTime } from "./plain-time.ts";
export { PlainDate } from "./plain-date.ts";
export { PlainDateTime } from "./plain-date-time.ts";
export { PlainYearMonth } from "./plain-year-month.ts";
export { PlainMonthDay } from "./plain-month-day.ts";

export { ZonedDateTime } from "./zoned-date-time.ts";
export { resolveTimeZoneIdentifier } from "./zone-like.ts";
export { NtsNow } from "./now.ts";
// This optional bridge is reached from Temporal integration, so importing Date
// arithmetic does not initialize Temporal or pull in nanosecond helpers.
export function dateToInstant(date: NtsDate): Instant {
  return Instant.fromEpochMilliseconds(NtsDate.milliseconds(date));
}
