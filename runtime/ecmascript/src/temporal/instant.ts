import { ISOParser } from "./iso-parser.ts";
import { epochDays, MS_PER_DAY } from "../date/calendar.ts";
import { formatISO, pad } from "../date/format.ts";
import {
  checkInstant,
  epochMilliseconds,
  floorDivide,
  NS_PER_DAY,
  NS_PER_HOUR,
  NS_PER_MILLISECOND,
  NS_PER_MINUTE,
  NS_PER_SECOND,
  roundNanoseconds,
} from "./exact.ts";
import type { RoundingMode } from "./exact.ts";

// This scalar parser is shared by the facade and compiled entry points. It
// never feeds an exact timestamp through Number or the legacy Date parser.
export function parseInstant(input: string): bigint {
  const parsed = new ISOParser(input);
  if (!parsed.hasOffset) throw new RangeError("Temporal instant strings require an offset");
  return checkInstant(
    BigInt(epochDays(parsed.year, parsed.month - 1, parsed.day)) * NS_PER_DAY +
      BigInt(parsed.timeNanoseconds()) -
      parsed.offsetNanoseconds,
  );
}

export function formatInstant(value: bigint, digits = -1): string {
  checkInstant(value);
  const milli = epochMilliseconds(value);
  // Date's clipped millisecond domain contains Instant's entire UTC domain.
  const base = formatISO(milli).slice(0, -5);
  const seconds = floorDivide(value, NS_PER_SECOND);
  const remainder = Number(value - seconds * NS_PER_SECOND);
  let fraction = pad(remainder, 9);
  if (digits < 0) {
    let end = fraction.length;
    while (end > 0 && fraction.charAt(end - 1) === "0") end--;
    fraction = fraction.slice(0, end);
  } else fraction = fraction.slice(0, digits);
  return base + (fraction.length > 0 ? "." + fraction : "") + "Z";
}

export function instantUnit(unit: string): bigint {
  if (unit === "hour" || unit === "hours") return NS_PER_HOUR;
  if (unit === "minute" || unit === "minutes") return NS_PER_MINUTE;
  if (unit === "second" || unit === "seconds") return NS_PER_SECOND;
  if (unit === "millisecond" || unit === "milliseconds") return NS_PER_MILLISECOND;
  if (unit === "microsecond" || unit === "microseconds") return 1000n;
  if (unit === "nanosecond" || unit === "nanoseconds") return 1n;
  throw new RangeError("Invalid instant unit");
}

export function roundInstant(
  value: bigint,
  unit: string,
  increment: number,
  mode: RoundingMode,
): bigint {
  const nanoUnit = instantUnit(unit);
  const maximum = Number(NS_PER_DAY / nanoUnit);
  if (
    !Number.isInteger(increment) ||
    increment < 1 ||
    increment > maximum ||
    maximum % increment !== 0
  )
    throw new RangeError("Invalid instant rounding increment");
  // Instant rounding treats increasing time as the positive direction even
  // before 1970. Duration rounding uses signed magnitude instead.
  const instantMode =
    mode === "trunc"
      ? "floor"
      : mode === "expand"
        ? "ceil"
        : mode === "halfTrunc"
          ? "halfFloor"
          : mode === "halfExpand"
            ? "halfCeil"
            : mode;
  return checkInstant(roundNanoseconds(value, nanoUnit * BigInt(increment), instantMode));
}

// Keep the pure nanosecond/ISO entry points independent of locale providers.
export function instantEpochDay(value: bigint): number {
  return Math.floor(epochMilliseconds(value) / MS_PER_DAY);
}
