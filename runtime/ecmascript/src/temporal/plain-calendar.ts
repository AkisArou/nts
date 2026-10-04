import { PlainDate } from "./plain-date.ts";
import { PlainDateTime } from "./plain-date-time.ts";
import { PlainYearMonth } from "./plain-year-month.ts";
import { PlainMonthDay } from "./plain-month-day.ts";
import { calendarIdentifierFromString, requireISOCalendarString } from "./calendar-id.ts";
import { ZonedDateTime } from "./zoned-date-time.ts";
import type { CalendarContext } from "./calendar-context.ts";
import { resolveCalendar } from "./calendar-environment.ts";
import type { CalendarEnvironment } from "./calendar-environment.ts";

// Class identity checks stay out of the scalar identifier/parser module.
export function isPlainCalendar(value: object): boolean {
  if (value instanceof ZonedDateTime) {
    ZonedDateTime.epochNanoseconds(value);
    return true;
  }
  return (
    value instanceof PlainDate ||
    value instanceof PlainDateTime ||
    value instanceof PlainYearMonth ||
    value instanceof PlainMonthDay
  );
}
export function requireISOCalendarLike(value: Temporal.CalendarLike): void {
  if (typeof value === "string") requireISOCalendarString(value);
  else if (value instanceof PlainDate) {
    if (PlainDate.calendarContext(value) !== undefined)
      throw new RangeError("Non-ISO dates require calendar integration");
  } else if (!isPlainCalendar(value))
    throw new TypeError("Calendar requires a string or Temporal date");
}

export function resolveCalendarLike(
  value: Temporal.CalendarLike,
  environment: CalendarEnvironment | undefined = undefined,
): CalendarContext | undefined {
  if (typeof value === "string")
    return resolveCalendar(calendarIdentifierFromString(value), environment);
  if (value instanceof PlainDate) return PlainDate.calendarContext(value);
  if (!isPlainCalendar(value)) throw new TypeError("Calendar requires a string or Temporal date");
  return undefined;
}
