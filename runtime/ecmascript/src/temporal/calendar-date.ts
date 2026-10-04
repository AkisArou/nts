import type { CalendarContext } from "./calendar-context.ts";
import { balanceISODate, checkDateDay } from "./iso-date.ts";

// A resolved non-ISO context is explicit. ISO retains its scalar arithmetic
// fast path and acquires no calendar provider, cursor or year snapshot.
export function balanceDate(
  start: number,
  years: number,
  months: number,
  weeks: number,
  days: number,
  overflow: NonNullable<Temporal.OverflowOptions["overflow"]>,
  calendar: CalendarContext | undefined = undefined,
): number {
  return calendar === undefined
    ? balanceISODate(start, years, months, weeks, days, overflow)
    : calendar.balanceDate(start, years, months, weeks, days, overflow);
}

export function addDate(
  start: number,
  years: number,
  months: number,
  weeks: number,
  days: number,
  overflow: NonNullable<Temporal.OverflowOptions["overflow"]>,
  calendar: CalendarContext | undefined = undefined,
): number {
  return checkDateDay(balanceDate(start, years, months, weeks, days, overflow, calendar));
}
