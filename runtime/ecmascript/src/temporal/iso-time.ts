import { integerWithTruncation } from "./options.ts";
import { pad } from "../date/format.ts";

export function timeNanoseconds(
  hour: number,
  minute: number,
  second: number,
  millisecond: number,
  microsecond: number,
  nanosecond: number,
): number {
  const h = integerWithTruncation(hour);
  const m = integerWithTruncation(minute);
  const s = integerWithTruncation(second);
  const ms = integerWithTruncation(millisecond);
  const us = integerWithTruncation(microsecond);
  const ns = integerWithTruncation(nanosecond);
  if (
    h < 0 ||
    h > 23 ||
    m < 0 ||
    m > 59 ||
    s < 0 ||
    s > 59 ||
    ms < 0 ||
    ms > 999 ||
    us < 0 ||
    us > 999 ||
    ns < 0 ||
    ns > 999
  )
    throw new RangeError("Temporal time field outside range");
  return ((h * 60 + m) * 60 + s) * 1e9 + ms * 1e6 + us * 1000 + ns;
}

export function formatPlainTime(value: number, precision = -1): string {
  const hour = Math.floor(value / 3600000000000);
  const minute = Math.floor(value / 60000000000) % 60;
  let result = pad(hour, 2) + ":" + pad(minute, 2);
  if (precision === -2) return result;
  result += ":" + pad(Math.floor(value / 1e9) % 60, 2);
  let fraction = pad(value % 1e9, 9);
  if (precision < 0) {
    let end = fraction.length;
    while (end > 0 && fraction.charAt(end - 1) === "0") end--;
    fraction = fraction.slice(0, end);
  } else fraction = fraction.slice(0, precision);
  return result + (fraction.length === 0 ? "" : "." + fraction);
}
