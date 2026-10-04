import { ISOParser } from "./iso-parser.ts";
import { requireOptions } from "./options.ts";
import { calendarIndex, canonicalCalendarIdentifier } from "./calendar-identifier.ts";

// Identifier and annotation semantics have no provider or value-class imports.
export function calendarIdentifierFromString(calendar: string): string {
  if (typeof calendar !== "string") throw new TypeError("Calendar must be a string");
  const id = calendar.toLowerCase();
  if (calendarIndex(id) >= 0 || id === "islamicc" || id === "ethiopic-amete-alem")
    return canonicalCalendarIdentifier(id);
  const digits = leadingDigits(calendar);
  const time =
    calendar.charAt(0) === "T" ||
    calendar.charAt(0) === "t" ||
    calendar.charAt(2) === ":" ||
    (digits === 2 && calendar.charAt(2) !== "-") ||
    (digits === 6 && (Number(calendar.slice(4, 6)) < 1 || Number(calendar.slice(4, 6)) > 12));
  const parsed = new ISOParser(calendar, time, true, true);
  return canonicalCalendarIdentifier(parsed.calendar);
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
export function calendarAnnotation(
  identifier: string,
  show: NonNullable<Temporal.PlainDateToStringOptions["calendarName"]>,
): string {
  if (show === "never" || (show === "auto" && identifier === "iso8601")) return "";
  return "[" + (show === "critical" ? "!" : "") + "u-ca=" + identifier + "]";
}
