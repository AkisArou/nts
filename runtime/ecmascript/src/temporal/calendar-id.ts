import { ISOParser } from "./iso-parser.ts";
import { requireOptions } from "./options.ts";

// The ISO path has no locale/calendar provider dependency. The calendar stage
// extends identifier resolution for other built-in calendars independently.
export function requireISOCalendar(calendar: string): void {
  if (typeof calendar !== "string") throw new TypeError("Calendar must be a string");
  if (calendar.toLowerCase() !== "iso8601") throw new RangeError("Non-ISO dates require calendar integration");
}
export function requireISOCalendarString(calendar: string): void {
  if (typeof calendar !== "string") throw new TypeError("Calendar must be a string");
  if (calendar.toLowerCase() === "iso8601") return;
  const parsed = new ISOParser(calendar, false, true, true);
  requireISOCalendar(parsed.calendar);
}
export function calendarName(options?: Readonly<Temporal.PlainDateToStringOptions>): NonNullable<Temporal.PlainDateToStringOptions["calendarName"]> {
  if (options !== undefined) requireOptions(options);
  const raw = options?.calendarName;
  if (typeof raw === "symbol") throw new TypeError("Calendar name option rejects Symbols");
  const show = raw === undefined ? "auto" : String(raw);
  if (show === "auto" || show === "always" || show === "never" || show === "critical") return show;
  throw new RangeError("Invalid calendar name option");
}
export function isoCalendarAnnotation(show: NonNullable<Temporal.PlainDateToStringOptions["calendarName"]>): string {
  return show === "always" ? "[u-ca=iso8601]" : show === "critical" ? "[!u-ca=iso8601]" : "";
}
