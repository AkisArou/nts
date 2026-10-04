import { PlainDate } from "./plain-date.ts";
import { PlainDateTime } from "./plain-date-time.ts";
import { PlainYearMonth } from "./plain-year-month.ts";
import { PlainMonthDay } from "./plain-month-day.ts";
import { calendarIdentifierFromString } from "./calendar-id.ts";
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
export function resolveCalendarLike(
  value: Temporal.CalendarLike,
  environment: CalendarEnvironment | undefined = undefined,
): CalendarContext | undefined {
  if (typeof value === "string")
    return resolveCalendar(calendarIdentifierFromString(value), environment);
  if (!isPlainCalendar(value)) throw new TypeError("Calendar requires a string or Temporal date");
  return calendarContextFor(value);
}

// Internal-slot extraction for a known Temporal object. Unlike field-bag
// preparation, this never observes an overridden public calendarId getter.
export function calendarContextFor(value: object): CalendarContext | undefined {
  if (value instanceof ZonedDateTime) return ZonedDateTime.calendarContext(value);
  if (value instanceof PlainDate) return PlainDate.calendarContext(value);
  if (value instanceof PlainDateTime) return PlainDateTime.calendarContext(value);
  if (value instanceof PlainYearMonth) return PlainYearMonth.calendarContext(value);
  if (value instanceof PlainMonthDay) return PlainMonthDay.calendarContext(value);
  return undefined;
}
