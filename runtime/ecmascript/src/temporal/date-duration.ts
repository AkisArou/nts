import { yearFromDays, monthFromTime, dateFromTime, modulo, MS_PER_DAY } from "../date/calendar.ts";
import { Duration } from "./duration.ts";
import { roundNanoseconds } from "./exact.ts";
import type { RoundingMode } from "./exact.ts";
import { checkDateDay } from "./iso-date.ts";
import { addDate, balanceDate } from "./calendar-date.ts";
import type { CalendarContext } from "./calendar-context.ts";

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
function differenceISODate(start: number, end: number, largest: number): Duration {
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
  days = end - balanceDate(start, years, months, 0, 0, "constrain");
  return new Duration(years, months, 0, days);
}

export function differenceDate(
  start: number,
  end: number,
  largest: number,
  calendar: CalendarContext | undefined = undefined,
): Duration {
  if (calendar === undefined || largest >= 2 || start === end)
    return differenceISODate(start, end, largest);
  const first = calendar.yearAt(start);
  const last = calendar.yearAt(end);
  const sign = end < start ? -1 : 1;
  let years = largest === 0 ? last.year - first.year : 0;
  if (years !== 0 && calendar.surpasses(start, end, years, 0, sign)) years -= sign;
  const candidate = years === 0 ? first : calendar.yearFor(first.year + years);
  const month = candidate.resolveMonth(
    undefined,
    first.monthCodeNumber(first.monthAt(start)),
    "constrain",
  );
  let months = calendar.monthDistance(candidate, month, last, last.monthAt(end));
  if (months !== 0 && calendar.surpasses(start, end, years, months, sign)) months -= sign;
  const days = end - balanceDate(start, years, months, 0, 0, "constrain", calendar);
  return new Duration(years, months, 0, days);
}

export function roundDateDifference(
  start: number,
  end: number,
  largest: number,
  smallest: number,
  increment: number,
  mode: RoundingMode,
  calendar: CalendarContext | undefined = undefined,
): Duration {
  if (smallest === 3 && largest >= 2) {
    const days = Number(roundNanoseconds(BigInt(end - start), BigInt(increment), mode));
    const weeks = largest === 2 ? Math.trunc(days / 7) : 0;
    return new Duration(0, 0, weeks, days - weeks * 7);
  }
  const raw = differenceDate(start, end, largest, calendar);
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
  const truncated = addDate(start, years, months, weeks, days, "constrain", calendar);
  const direction = end < start ? -1 : 1;
  const step = increment * direction;
  const adjacent = balanceDate(
    start,
    years + (smallest === 0 ? step : 0),
    months + (smallest === 1 ? step : 0),
    weeks + (smallest === 2 ? step : 0),
    days + (smallest === 3 ? step : 0),
    "constrain",
    calendar,
  );
  if (smallest < 3) checkDateDay(adjacent);
  const span = BigInt(Math.abs(adjacent - truncated));
  const rounded =
    roundNanoseconds(BigInt(quotient) * span + BigInt(end - truncated), span, mode) / span;
  return differenceDate(
    start,
    checkDateDay(rounded === BigInt(quotient) ? truncated : adjacent),
    largest,
    calendar,
  );
}
