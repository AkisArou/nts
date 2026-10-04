import { PlainDate } from "./plain-date.ts";
import { PlainDateTime } from "./plain-date-time.ts";
import { PlainYearMonth } from "./plain-year-month.ts";
import { PlainMonthDay } from "./plain-month-day.ts";
import { requireISOCalendarString } from "./calendar-id.ts";

// Class identity checks stay out of the scalar identifier/parser module.
export function isPlainCalendar(value: object): boolean {
  return (
    value instanceof PlainDate ||
    value instanceof PlainDateTime ||
    value instanceof PlainYearMonth ||
    value instanceof PlainMonthDay
  );
}
export function requireISOCalendarLike(value: Temporal.CalendarLike): void {
  if (typeof value === "string") requireISOCalendarString(value);
  else if (!isPlainCalendar(value))
    throw new TypeError("Calendar requires a string or Temporal date");
}
