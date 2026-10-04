import { CalendarContext } from "../../../../../runtime/ecmascript/src/temporal/calendar-context.ts";
import { ArithmeticCalendar } from "../../../../../runtime/ecmascript/src/temporal/arithmetic-calendar.ts";
import { HebrewCalendar } from "../../../../../runtime/ecmascript/src/temporal/hebrew-calendar.ts";
import { LunisolarCalendar } from "../../../../../runtime/ecmascript/src/temporal/lunisolar-calendar.ts";
import { LunisolarTable } from "../../../../../runtime/ecmascript/src/temporal/lunisolar-table.ts";

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

export function lunisolarTopology(identifier: string, epochDay: number): string {
  const context = new CalendarContext(
    identifier,
    new LunisolarCalendar(identifier, new LunisolarTable(identifier)),
  );
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

export function lunisolarMonthAddition(
  identifier: string,
  epochDay: number,
  months: number,
): number {
  const context = new CalendarContext(
    identifier,
    new LunisolarCalendar(identifier, new LunisolarTable(identifier)),
  );
  return context.balanceDate(epochDay, 0, months, 0, 0, "constrain");
}
