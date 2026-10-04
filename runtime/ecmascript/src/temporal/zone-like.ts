import { FixedTimeZone, UTC } from "../time/provider.ts";
import type { TimeZoneRules } from "../time/provider.ts";
import type { TimeZoneSource } from "../time/zone-data.ts";
import { formatOffsetTimeZone, offsetTimeZoneMinutes } from "../time/offset-zone-id.ts";
import { timeZoneIdentifier } from "./zone-id.ts";

export function resolveTimeZone(
  value: Temporal.TimeZoneLike,
  source: TimeZoneSource | undefined,
): TimeZoneRules {
  if (typeof value !== "string")
    throw new TypeError("A time zone requires a string or zoned date-time");
  const identifier = timeZoneIdentifier(value);
  const minutes = offsetTimeZoneMinutes(identifier);
  if (minutes !== undefined)
    return new FixedTimeZone(formatOffsetTimeZone(minutes), minutes * 60000);
  const lower = identifier.toLowerCase();
  if (lower === "utc") return UTC;
  if (lower === "etc/utc") return new FixedTimeZone("Etc/UTC", 0);
  if (lower === "etc/gmt") return new FixedTimeZone("Etc/GMT", 0);
  if (lower === "gmt") return new FixedTimeZone("GMT", 0);
  if (source === undefined)
    throw new RangeError("Named time zones require a time-zone environment");
  return source.resolveNamed(identifier);
}
