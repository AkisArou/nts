import { formatOffsetTimeZone, offsetTimeZoneMinutes } from "../time/offset-zone-id.ts";
import { ISOParser } from "./iso-parser.ts";
import { NS_PER_MINUTE } from "./exact.ts";
import { daysInMonth } from "../date/calendar.ts";

export function timeZoneIdentifier(value: string): string {
  const first = value.charCodeAt(0);
  // Named identifiers take the common path without constructing an ISO parser.
  if (
    !(
      (first >= 48 && first <= 57) ||
      first === 43 ||
      first === 45 ||
      ((first === 84 || first === 116) && value.charCodeAt(1) >= 48 && value.charCodeAt(1) <= 57)
    )
  )
    return value;
  if ((first === 43 || first === 45) && value.length <= 6)
    return formatOffsetTimeZone(offsetTimeZoneMinutes(value)!);
  // Select short date grammars before parsing. Unprefixed basic times that
  // also match a month-day or year-month are excluded by the time grammar.
  // This needs neither speculative parser objects nor exception-based retry.
  const annotation = value.indexOf("[");
  const end = annotation < 0 ? value.length : annotation;
  const monthDay = Number(value.slice(0, 2));
  const day = Number(value.slice(end === 5 ? 3 : 2, end));
  const month = Number(value.slice(end === 7 ? 5 : 4, end));
  const shortDate =
    first >= 48 &&
    first <= 57 &&
    (((end === 4 || (end === 5 && value.charAt(2) === "-")) &&
      monthDay >= 1 &&
      monthDay <= 12 &&
      day >= 1 &&
      day <= daysInMonth(1972, monthDay - 1)) ||
      ((end === 6 || (end === 7 && value.charAt(4) === "-")) && month >= 1 && month <= 12) ||
      (end === 8 && Number.isInteger(Number(value.slice(0, end)))));
  const parsed = new ISOParser(value, !shortDate, true, true);
  if (parsed.timeZone !== undefined) return parsed.timeZone;
  if (parsed.utcDesignator) return "UTC";
  if (!parsed.hasOffset || parsed.offsetHasSeconds)
    throw new RangeError("A time-zone string requires a zone or a minute-precision offset");
  return formatOffsetTimeZone(Number(parsed.offsetNanoseconds / NS_PER_MINUTE));
}
