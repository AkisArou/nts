import { FixedTimeZone, UTC } from "../time/provider.ts";
import type { TimeZoneSource, ResolvedTimeZone } from "../time/zone-data.ts";
import { formatOffsetTimeZone, offsetTimeZoneMinutes } from "../time/offset-zone-id.ts";
import { timeZoneIdentifier } from "./zone-id.ts";
import { ZonedDateTime } from "./zoned-date-time.ts";

export function resolveTimeZone(
  value: Temporal.TimeZoneLike | ZonedDateTime<ResolvedTimeZone>,
  source: TimeZoneSource | undefined,
): ResolvedTimeZone {
  if (value instanceof ZonedDateTime) return ZonedDateTime.rules(value);
  if (typeof value !== "string")
    throw new TypeError("A time zone requires a string or zoned date-time");
  return resolveTimeZoneIdentifier(timeZoneIdentifier(value), source);
}

// Constructor identifiers have a narrower grammar than TimeZoneLike strings.
// In particular, an ISO date-time carrying a zone is not an identifier.
export function resolveTimeZoneIdentifier(
  identifier: string,
  source: TimeZoneSource | undefined,
): ResolvedTimeZone {
  if (typeof identifier !== "string") throw new TypeError("Time-zone identifier must be a string");
  const minutes = offsetTimeZoneMinutes(identifier);
  if (minutes !== undefined)
    return new FixedTimeZone(formatOffsetTimeZone(minutes), minutes * 60000);
  const lower = identifier.toLowerCase();
  if (lower === "utc") return UTC;
  if (lower === "etc/utc") return new FixedTimeZone("Etc/UTC", 0, "UTC");
  if (lower === "etc/gmt") return new FixedTimeZone("Etc/GMT", 0, "UTC");
  if (lower === "gmt") return new FixedTimeZone("GMT", 0, "UTC");
  if (source === undefined)
    throw new RangeError("Named time zones require a time-zone environment");
  return source.resolveNamed(identifier);
}
