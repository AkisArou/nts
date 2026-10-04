import type { CalendarContext } from "./calendar-context.ts";
import { epochDays } from "../date/calendar.ts";
import { validCalendarMonthCode } from "./calendar-month-code.ts";

// The Chinese/Korean reference years are specified by Intl Era and MonthCode,
// NonISOMonthDayToISOReferenceDate, Table 6. They are not provider guesses.
const LONG_COMMON_YEARS = [1970, 1972, 1966, 1970, 1972, 1971, 1972, 1971, 1972, 1972, 1970, 1972];
const LEAP_YEARS = [0, 1947, 1966, 1963, 1971, 1960, 1968, 1957, 2014, 1984, 2033, 0];
const LONG_LEAP_YEARS = [0, 0, 1955, 1944, 1952, 1941, 1938, 0, 0, 0, 0, 0];

function maximumDay(identifier: string, code: number): number {
  switch (identifier) {
    case "chinese":
    case "dangi":
      return 30;
    case "islamic-civil":
    case "islamic-tbla":
      return code % 2 === 0 && code !== 12 ? 29 : 30;
    case "hebrew":
      return code === 4 || code === 6 || code === 8 || code === 10 || code === 12 ? 29 : 30;
    case "islamic-umalqura":
      return 30;
    case "coptic":
    case "ethiopic":
    case "ethioaa":
      return code === 13 ? 6 : 30;
    case "indian":
      return code <= 6 ? 31 : 30;
    case "persian":
      return code <= 6 ? 31 : 30;
    default:
      return code === 2 ? 29 : code === 4 || code === 6 || code === 9 || code === 11 ? 30 : 31;
  }
}

function findReference(
  calendar: CalendarContext,
  code: number,
  day: number,
  first: number,
  end: number,
  latest: boolean,
): number {
  let year = calendar.yearAt(latest ? end - 1 : first);
  while (year.endDay > first && year.firstDay < end) {
    for (
      let month = latest ? year.monthsInYear - 1 : 0;
      latest ? month >= 0 : month < year.monthsInYear;
      month += latest ? -1 : 1
    ) {
      if (year.monthCodeNumber(month) !== code || day > year.daysInMonth(month)) continue;
      const date = year.monthStart(month) + day - 1;
      if (date >= first && date < end) return date;
    }
    year = calendar.yearFor(year.year + (latest ? -1 : 1));
  }
  return NaN;
}

export function monthDayReference(
  calendar: CalendarContext,
  code: number,
  day: number,
  overflow: NonNullable<Temporal.OverflowOptions["overflow"]>,
): number {
  const identifier = calendar.identifier;
  if (!validCalendarMonthCode(identifier, code))
    throw new RangeError("Month code is invalid for calendar");
  const maximum = maximumDay(identifier, code);
  if (day > maximum) {
    if (overflow === "reject") throw new RangeError("Calendar day outside range");
    day = maximum;
  }
  if (identifier === "chinese" || identifier === "dangi") {
    let year =
      code > 100
        ? (day === 30 ? LONG_LEAP_YEARS : LEAP_YEARS)[code - 101]!
        : day === 30
          ? LONG_COMMON_YEARS[code - 1]!
          : 1972;
    if (code === 111 && day > 10 && day < 30) year = 2034;
    if (year === 0) {
      if (overflow === "reject") throw new RangeError("Lunisolar month-day has no reference date");
      code -= 100;
      year = day === 30 ? LONG_COMMON_YEARS[code - 1]! : 1972;
    }
    if (identifier === "dangi" && code === 3 && day === 30) year = 1968;
    const result = findReference(
      calendar,
      code,
      day,
      epochDays(year, 0, 1),
      epochDays(year + 1, 0, 1),
      true,
    );
    if (!Number.isInteger(result)) throw new RangeError("Lunisolar reference data is unavailable");
    return result;
  }
  // Normal dates resolve in one or two year snapshots. Only leap dates need
  // to look farther back. The normative search windows bound all work; the
  // retained two-year context cache avoids allocation on repeated queries.
  const split = epochDays(1973, 0, 1);
  let result = findReference(calendar, code, day, epochDays(1900, 0, 1), split, true);
  if (!Number.isInteger(result))
    result = findReference(calendar, code, day, split, epochDays(2036, 0, 1), false);
  if (!Number.isInteger(result)) throw new RangeError("Calendar month-day has no reference date");
  return result;
}
