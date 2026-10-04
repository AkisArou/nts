import { CalendarContext } from "../../../../../runtime/ecmascript/src/temporal/calendar-context.ts";
import { ArithmeticCalendar } from "../../../../../runtime/ecmascript/src/temporal/arithmetic-calendar.ts";
import { HebrewCalendar } from "../../../../../runtime/ecmascript/src/temporal/hebrew-calendar.ts";

// Actual shared year/cache boundary: implicit class conformance is deliberate.
// Adding implements or erasing the provider would bypass the compiler contract
// this source is meant to exercise.
export function arithmeticTopology(identifier: string, epochDay: number): string {
  const context = new CalendarContext(identifier, new ArithmeticCalendar(identifier));
  const year = context.yearAt(epochDay);
  const month = year.monthAt(epochDay);
  return (
    year.year +
    ":" +
    (month + 1) +
    ":" +
    (epochDay - year.monthStart(month) + 1) +
    ":" +
    year.monthCode(month) +
    ":" +
    (year.endDay - year.firstDay)
  );
}

export function hebrewTopology(epochDay: number): string {
  const context = new CalendarContext("hebrew", new HebrewCalendar());
  const year = context.yearAt(epochDay);
  const month = year.monthAt(epochDay);
  return (
    year.year +
    ":" +
    (month + 1) +
    ":" +
    (epochDay - year.monthStart(month) + 1) +
    ":" +
    year.monthCode(month) +
    ":" +
    (year.endDay - year.firstDay)
  );
}
