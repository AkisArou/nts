import {
  epochDays,
  yearFromDays,
  monthFromTime,
  dateFromTime,
  daysInMonth,
  modulo,
  MS_PER_DAY,
} from "../date/calendar.ts";
import { Duration } from "./duration.ts";
import { isoYear, pad } from "../date/format.ts";
import { roundNanoseconds } from "./exact.ts";
import type { RoundingMode } from "./exact.ts";

export function formatISODate(day: number): string {
  const time = day * MS_PER_DAY;
  return isoYear(yearFromDays(day)) + "-" + pad(monthFromTime(time) + 1, 2) + "-" + pad(dateFromTime(time), 2);
}

// Plain dates include the day before Instant's lower bound. Noon on both
// endpoints lies strictly inside Temporal's extended plain-date-time domain.
export function checkDateDay(day: number): number {
  if (!Number.isInteger(day) || day < -100000001 || day > 100000000)
    throw new RangeError("Plain date outside supported range");
  return day;
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

function surpasses(
  year: number,
  month: number,
  day: number,
  targetYear: number,
  targetMonth: number,
  targetDay: number,
  sign: number,
): boolean {
  return year !== targetYear
    ? sign * (year - targetYear) > 0
    : month !== targetMonth
      ? sign * (month - targetMonth) > 0
      : sign * (day - targetDay) > 0;
}

// The spec's iterative search is equivalent to these bounded year/month
// estimates and one adjustment. Even dates 200 million days apart stay O(1).
export function differenceISODate(start: number, end: number, largest: number): Duration {
  let days = end - start;
  if (largest === 3) return new Duration(0, 0, 0, days);
  if (largest === 2) {
    const weeks = Math.trunc(days / 7);
    return new Duration(0, 0, weeks, days - weeks * 7);
  }
  const first = start * MS_PER_DAY;
  const last = end * MS_PER_DAY;
  const sign = days < 0 ? -1 : 1;
  const year = yearFromDays(start);
  const targetYear = yearFromDays(end);
  const month = monthFromTime(first);
  const targetMonth = monthFromTime(last);
  const date = dateFromTime(first);
  const targetDate = dateFromTime(last);
  let years = largest === 0 ? targetYear - year : 0;
  if (
    years !== 0 &&
    surpasses(year + years, month, date, targetYear, targetMonth, targetDate, sign)
  )
    years -= sign;
  let months = (targetYear - year - years) * 12 + targetMonth - month;
  const candidateMonth = month + months;
  if (
    months !== 0 &&
    surpasses(
      year + years + Math.floor(candidateMonth / 12),
      modulo(candidateMonth, 12),
      date,
      targetYear,
      targetMonth,
      targetDate,
      sign,
    )
  )
    months -= sign;
  days = end - addISODate(start, years, months, 0, 0, "constrain");
  return new Duration(years, months, 0, days);
}

export function roundISODateDifference(
  start: number,
  end: number,
  largest: number,
  smallest: number,
  increment: number,
  mode: RoundingMode,
): Duration {
  if (smallest === 3 && largest >= 2) {
    const days = Number(roundNanoseconds(BigInt(end - start), BigInt(increment), mode));
    const weeks = largest === 2 ? Math.trunc(days / 7) : 0;
    return new Duration(0, 0, weeks, days - weeks * 7);
  }
  const raw = differenceISODate(start, end, largest);
  if (start === end || (smallest === 3 && increment === 1)) return raw;
  const amount =
    smallest === 0
      ? raw.years
      : smallest === 1
        ? raw.months
        : smallest === 2
          ? raw.weeks + Math.trunc(raw.days / 7)
          : raw.days;
  const quotient = Math.trunc(amount / increment);
  const years = smallest > 0 ? raw.years : quotient * increment;
  const months = smallest > 1 ? raw.months : smallest === 1 ? quotient * increment : 0;
  const weeks = smallest > 2 ? raw.weeks : smallest === 2 ? quotient * increment : 0;
  const days = smallest === 3 ? quotient * increment : 0;
  const truncated = addISODate(start, years, months, weeks, days, "constrain");
  const direction = end < start ? -1 : 1;
  const step = increment * direction;
  const adjacent = balanceISODate(
    start,
    years + (smallest === 0 ? step : 0),
    months + (smallest === 1 ? step : 0),
    weeks + (smallest === 2 ? step : 0),
    days + (smallest === 3 ? step : 0),
    "constrain",
  );
  if (smallest < 3) checkDateDay(adjacent);
  const span = BigInt(Math.abs(adjacent - truncated));
  const rounded =
    roundNanoseconds(BigInt(quotient) * span + BigInt(end - truncated), span, mode) / span;
  return differenceISODate(
    start,
    checkDateDay(rounded === BigInt(quotient) ? truncated : adjacent),
    largest,
  );
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
