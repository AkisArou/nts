import { daysInMonth, epochDays, MS_PER_DAY } from "../date/calendar.ts";
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
  let index = 0;
  function fail(): never {
    throw new RangeError("Invalid Temporal instant");
  }
  function digits(count: number): number {
    let value = 0;
    for (let i = 0; i < count; i++) {
      const code = input.charCodeAt(index++);
      if (!(code >= 48 && code <= 57)) fail();
      value = value * 10 + code - 48;
    }
    return value;
  }
  function take(character: string): boolean {
    if (input.charAt(index) !== character) return false;
    index++;
    return true;
  }
  function fraction(): number {
    if (!take(".") && !take(",")) return 0;
    let value = 0;
    let count = 0;
    while (index < input.length) {
      const code = input.charCodeAt(index);
      if (code < 48 || code > 57) break;
      if (++count > 9) fail();
      value = value * 10 + code - 48;
      index++;
    }
    if (count === 0) fail();
    return value * 10 ** (9 - count);
  }
  let sign = 1;
  let extended = false;
  if (take("-")) {
    sign = -1;
    extended = true;
  } else if (take("+")) extended = true;
  const year = sign * digits(extended ? 6 : 4);
  if (sign === -1 && year === 0) fail();
  const separatedDate = take("-");
  const month = digits(2);
  if (separatedDate && !take("-")) fail();
  const day = digits(2);
  if (!(month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth(year, month - 1))) fail();
  if (!take("T") && !take("t") && !take(" ")) fail();
  const hour = digits(2);
  let minute = 0;
  let second = 0;
  let nano = 0;
  if (take(":")) {
    minute = digits(2);
    if (take(":")) {
      second = digits(2);
      nano = fraction();
    }
  } else if (input.charCodeAt(index) >= 48 && input.charCodeAt(index) <= 57) {
    minute = digits(2);
    if (input.charCodeAt(index) >= 48 && input.charCodeAt(index) <= 57) {
      second = digits(2);
      nano = fraction();
    }
  }
  if (hour > 23 || minute > 59 || second > 60) fail();
  if (second === 60) second = 59;
  let offset = 0n;
  if (!take("Z") && !take("z")) {
    const negative = take("-");
    if (!negative && !take("+")) fail();
    const offsetHour = digits(2);
    let offsetMinute = 0;
    let offsetSecond = 0;
    let offsetNano = 0;
    if (take(":")) {
      offsetMinute = digits(2);
      if (take(":")) {
        offsetSecond = digits(2);
        offsetNano = fraction();
      }
    } else if (input.charCodeAt(index) >= 48 && input.charCodeAt(index) <= 57) {
      offsetMinute = digits(2);
      if (input.charCodeAt(index) >= 48 && input.charCodeAt(index) <= 57) {
        offsetSecond = digits(2);
        offsetNano = fraction();
      }
    }
    if (offsetHour > 23 || offsetMinute > 59 || offsetSecond > 59) fail();
    offset =
      BigInt(offsetHour) * NS_PER_HOUR +
      BigInt(offsetMinute) * NS_PER_MINUTE +
      BigInt(offsetSecond) * NS_PER_SECOND +
      BigInt(offsetNano);
    if (negative) offset = -offset;
  }
  // Annotations are syntax only for Instant. Named time zone resolution and
  // calendar selection belong to Zoned/Plain algorithms, not this parser.
  let calendarCount = 0;
  let criticalCalendar = false;
  let zoneCount = 0;
  let keyAnnotation = false;
  while (take("[")) {
    const critical = take("!");
    const start = index;
    while (index < input.length && input.charAt(index) !== "]") index++;
    if (index === start || !take("]")) fail();
    const annotation = input.slice(start, index - 1);
    const equals = annotation.indexOf("=");
    if (equals >= 0) {
      keyAnnotation = true;
      const key = annotation.slice(0, equals);
      const value = annotation.slice(equals + 1);
      if (key.length === 0 || value.length === 0) fail();
      for (let i = 0; i < key.length; i++) {
        const code = key.charCodeAt(i);
        if (
          !(
            (code >= 97 && code <= 122) ||
            code === 95 ||
            (i > 0 && ((code >= 48 && code <= 57) || code === 45))
          )
        )
          fail();
      }
      for (let i = 0; i < value.length; i++) {
        const code = value.charCodeAt(i);
        if (
          !(
            (code >= 97 && code <= 122) ||
            (code >= 65 && code <= 90) ||
            (code >= 48 && code <= 57) ||
            (code === 45 && i > 0 && i + 1 < value.length && value.charAt(i - 1) !== "-")
          )
        )
          fail();
      }
      if (key === "u-ca") {
        calendarCount++;
        criticalCalendar = criticalCalendar || critical;
        if (calendarCount > 1 && criticalCalendar) fail();
      } else if (critical) fail();
    } else {
      if (++zoneCount > 1 || keyAnnotation) fail();
      const first = annotation.charAt(0);
      if (first === "+" || first === "-") {
        const body = annotation.slice(1).replace(":", "");
        if (body.length !== 2 && body.length !== 4) fail();
        for (let i = 0; i < body.length; i++)
          if (!(body.charCodeAt(i) >= 48 && body.charCodeAt(i) <= 57)) fail();
        if (Number(body.slice(0, 2)) > 23 || (body.length === 4 && Number(body.slice(2)) > 59))
          fail();
      } else {
        for (let i = 0; i < annotation.length; i++) {
          const code = annotation.charCodeAt(i);
          if (
            !(
              (code >= 97 && code <= 122) ||
              (code >= 65 && code <= 90) ||
              (code >= 48 && code <= 57) ||
              code === 95 ||
              code === 45 ||
              code === 43 ||
              code === 46 ||
              code === 47
            )
          )
            fail();
        }
      }
    }
  }
  if (index !== input.length) fail();
  return checkInstant(
    BigInt(epochDays(year, month - 1, day)) * NS_PER_DAY +
      BigInt(hour) * NS_PER_HOUR +
      BigInt(minute) * NS_PER_MINUTE +
      BigInt(second) * NS_PER_SECOND +
      BigInt(nano) -
      offset,
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
