import {
  epochDays,
  yearFromDays,
  monthFromTime,
  dateFromTime,
  daysInMonth,
  modulo,
  MS_PER_DAY,
} from "../date/calendar.ts";
import { isoYear, pad } from "../date/format.ts";

export function formatISODate(day: number): string {
  const time = day * MS_PER_DAY;
  return (
    isoYear(yearFromDays(day)) +
    "-" +
    pad(monthFromTime(time) + 1, 2) +
    "-" +
    pad(dateFromTime(time), 2)
  );
}

// Plain dates include the day before Instant's lower bound. Noon on both
// endpoints lies strictly inside Temporal's extended plain-date-time domain.
export function checkDateDay(day: number): number {
  if (!Number.isInteger(day) || day < -100000001 || day > 100000000)
    throw new RangeError("Plain date outside supported range");
  return day;
}

export function checkDateTime(day: number, time: number): void {
  if (
    !Number.isInteger(day) ||
    day < -100000001 ||
    day > 100000000 ||
    (day === -100000001 && time === 0)
  )
    throw new RangeError("Plain date-time outside supported range");
}

export function regulateISODate(
  year: number,
  month: number,
  day: number,
  overflow: NonNullable<Temporal.OverflowOptions["overflow"]>,
): number {
  if (overflow === "constrain") {
    month = Math.max(1, Math.min(12, month));
    day = Math.max(1, Math.min(daysInMonth(year, month - 1), day));
  } else if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month - 1))
    throw new RangeError("Invalid ISO date fields");
  return epochDays(year, month - 1, day);
}

export function balanceISODate(
  day: number,
  years: number,
  months: number,
  weeks: number,
  days: number,
  overflow: NonNullable<Temporal.OverflowOptions["overflow"]>,
): number {
  const time = day * MS_PER_DAY;
  const month = monthFromTime(time) + months;
  const year = yearFromDays(day) + years + Math.floor(month / 12);
  const intermediate = regulateISODate(year, modulo(month, 12) + 1, dateFromTime(time), overflow);
  return intermediate + weeks * 7 + days;
}
export function addISODate(
  day: number,
  years: number,
  months: number,
  weeks: number,
  days: number,
  overflow: NonNullable<Temporal.OverflowOptions["overflow"]>,
): number {
  return checkDateDay(balanceISODate(day, years, months, weeks, days, overflow));
}

export function dateUnitIndex(unit: string): number {
  if (typeof unit === "symbol") throw new TypeError("Temporal string options reject Symbols");
  const text = String(unit);
  if (text === "year" || text === "years") return 0;
  if (text === "month" || text === "months") return 1;
  if (text === "week" || text === "weeks") return 2;
  if (text === "day" || text === "days") return 3;
  throw new RangeError("Invalid date unit");
}

export function isoWeekYear(day: number): number {
  const weekday = modulo(day + 3, 7) + 1;
  return yearFromDays(day + 4 - weekday);
}
export function isoWeek(day: number): number {
  const year = isoWeekYear(day);
  const first = epochDays(year, 0, 4);
  const monday = first - modulo(first + 3, 7);
  return Math.floor((day - monday) / 7) + 1;
}
