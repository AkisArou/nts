import { pad } from "../date/format.ts";

function twoDigits(value: string, from: number): number {
  const first = value.charCodeAt(from) - 48;
  const last = value.charCodeAt(from + 1) - 48;
  if (first < 0 || first > 9 || last < 0 || last > 9 || Number.isNaN(first) || Number.isNaN(last))
    throw new RangeError("Invalid time-zone offset identifier");
  return first * 10 + last;
}

// Intl identifiers allow hours with optional minutes, without seconds or
// fractions. Temporal's full timestamp offset grammar is intentionally wider.
export function offsetTimeZoneMinutes(identifier: string): number | undefined {
  const sign = identifier.charAt(0);
  if (sign !== "+" && sign !== "-") return undefined;
  const length = identifier.length;
  if (length !== 3 && length !== 5 && length !== 6)
    throw new RangeError("Invalid time-zone offset identifier");
  const hours = twoDigits(identifier, 1);
  if (length === 6 && identifier.charAt(3) !== ":")
    throw new RangeError("Invalid time-zone offset identifier");
  const minutes = length === 3 ? 0 : twoDigits(identifier, length === 6 ? 4 : 3);
  if (hours > 23 || minutes > 59) throw new RangeError("Time-zone offset is out of range");
  return (hours * 60 + minutes) * (sign === "-" ? -1 : 1);
}
export function formatOffsetTimeZone(minutes: number): string {
  const value = Math.abs(minutes);
  return (minutes < 0 ? "-" : "+") + pad(Math.floor(value / 60), 2) + ":" + pad(value % 60, 2);
}
