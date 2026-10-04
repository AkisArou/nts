import { ISOParser } from "./iso-parser.ts";
import { requireOptions } from "./options.ts";

// The ISO path has no locale/calendar provider dependency. The calendar stage
// extends identifier resolution for other built-in calendars independently.
export function requireISOCalendar(calendar: string): void {
  if (typeof calendar !== "string") throw new TypeError("Calendar must be a string");
  if (calendar.toLowerCase() !== "iso8601")
    throw new RangeError("Non-ISO dates require calendar integration");
}
export function requireISOCalendarString(calendar: string): void {
  if (typeof calendar !== "string") throw new TypeError("Calendar must be a string");
  if (calendar.toLowerCase() === "iso8601") return;
  const digits = leadingDigits(calendar);
  const time =
    calendar.charAt(0) === "T" ||
    calendar.charAt(0) === "t" ||
    calendar.charAt(2) === ":" ||
    (digits === 2 && calendar.charAt(2) !== "-") ||
    (digits === 6 && (Number(calendar.slice(4, 6)) < 1 || Number(calendar.slice(4, 6)) > 12));
  const parsed = new ISOParser(calendar, time, true, true);
  requireISOCalendar(parsed.calendar);
}
function leadingDigits(value: string): number {
  let length = 0;
  while (value.charCodeAt(length) >= 48 && value.charCodeAt(length) <= 57) length++;
  return length;
}
export function calendarName(
  options?: Readonly<Temporal.PlainDateToStringOptions>,
): NonNullable<Temporal.PlainDateToStringOptions["calendarName"]> {
  if (options !== undefined) requireOptions(options);
  const raw = options?.calendarName;
  if (typeof raw === "symbol") throw new TypeError("Calendar name option rejects Symbols");
  const show = raw === undefined ? "auto" : String(raw);
  if (show === "auto" || show === "always" || show === "never" || show === "critical") return show;
  throw new RangeError("Invalid calendar name option");
}
export function isoCalendarAnnotation(
  show: NonNullable<Temporal.PlainDateToStringOptions["calendarName"]>,
): string {
  return show === "always" ? "[u-ca=iso8601]" : show === "critical" ? "[!u-ca=iso8601]" : "";
}
