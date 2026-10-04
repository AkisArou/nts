import type { CalendarPrimitive } from "./calendar-data.ts";
import { CalendarYear } from "./calendar-year.ts";

// One environment-owned calendar cursor and two immutable year snapshots.
// Values may retain a snapshot: replacing the cache never mutates that year.
// A resolved calendar identity and its data source arrive together; this layer
// has no concrete provider imports or global environment state.
export class CalendarContext {
  readonly identifier: string;
  readonly #data: CalendarPrimitive;
  #recent: CalendarYear | undefined;
  #previous: CalendarYear | undefined;

  constructor(identifier: string, data: CalendarPrimitive) {
    this.identifier = identifier;
    this.#data = data;
  }

  yearAt(epochDay: number): CalendarYear {
    const recent = this.#recent;
    if (recent !== undefined && epochDay >= recent.firstDay && epochDay < recent.endDay)
      return recent;
    const previous = this.#previous;
    if (previous !== undefined && epochDay >= previous.firstDay && epochDay < previous.endDay) {
      this.#previous = recent;
      this.#recent = previous;
      return previous;
    }
    const result = new CalendarYear(this.identifier, this.#data, epochDay);
    this.#previous = recent;
    this.#recent = result;
    return result;
  }

  yearFor(year: number): CalendarYear {
    if (!Number.isInteger(year)) throw new RangeError("Calendar year must be an integer");
    const recent = this.#recent;
    if (recent !== undefined && recent.year === year) return recent;
    const previous = this.#previous;
    if (previous !== undefined && previous.year === year) {
      this.#previous = recent;
      this.#recent = previous;
      return previous;
    }
    // The reverse primitive is an estimate. Validate its actual chronology;
    // never accept a provider's normalized fields as the requested JS date.
    let estimate = this.#data.estimateEpochDay(year, 0, 1);
    for (let attempt = 0; attempt < 4; attempt++) {
      if (!Number.isInteger(estimate)) break;
      const result = this.yearAt(estimate);
      if (result.year === year) return result;
      estimate += (year - result.year) * 365;
    }
    throw new RangeError("Calendar year data is unavailable");
  }

  private shiftedMonth(year: CalendarYear, month: number, months: number): number {
    if (Math.abs(months) <= 24) {
      month += months;
      while (month < 0) {
        year = this.yearFor(year.year - 1);
        month += year.monthsInYear;
      }
      while (month >= year.monthsInYear) {
        month -= year.monthsInYear;
        year = this.yearFor(year.year + 1);
      }
    } else {
      // All supported calendar years lie within +/-300,000 and contain at
      // most 13 months. Reject enormous durations before inverse arithmetic;
      // this also keeps every intermediate month coordinate exactly integral.
      const index = this.#data.monthIndex(year.year, month) + months;
      if (!Number.isInteger(index) || Math.abs(index) > 4000000)
        throw new RangeError("Calendar month is outside supported range");
      year = this.yearFor(this.#data.yearFromMonthIndex(index));
      month = index - this.#data.monthIndex(year.year, 0);
      if (month < 0 || month >= year.monthsInYear)
        throw new RangeError("Calendar month coordinates disagree");
    }
    return year.monthStart(month);
  }

  // Calendar years preserve month codes, whereas calendar months count actual
  // months, including leap months. Small additions use the existing snapshots;
  // large additions use bounded month coordinates rather than walking years.
  balanceDate(
    epochDay: number,
    years: number,
    months: number,
    weeks: number,
    days: number,
    overflow: NonNullable<Temporal.OverflowOptions["overflow"]>,
  ): number {
    if (years === 0 && months === 0) return epochDay + weeks * 7 + days;
    const first = this.yearAt(epochDay);
    const originalMonth = first.monthAt(epochDay);
    const date = epochDay - first.monthStart(originalMonth) + 1;
    const target = years === 0 ? first : this.yearFor(first.year + years);
    const month =
      years === 0
        ? originalMonth
        : target.resolveMonth(undefined, first.monthCodeNumber(originalMonth), overflow);
    const start = this.shiftedMonth(target, month, months);
    const resultYear = this.yearAt(start);
    return resultYear.date(resultYear.monthAt(start), date, overflow) + weeks * 7 + days;
  }

  monthDistance(
    first: CalendarYear,
    firstMonth: number,
    last: CalendarYear,
    lastMonth: number,
  ): number {
    if (first.year === last.year) return lastMonth - firstMonth;
    if (last.year === first.year + 1) return first.monthsInYear + lastMonth - firstMonth;
    if (last.year === first.year - 1) return lastMonth - firstMonth - last.monthsInYear;
    return (
      this.#data.monthIndex(last.year, lastMonth) - this.#data.monthIndex(first.year, firstMonth)
    );
  }

  // NonISODateSurpasses first compares the preserved month code, then the
  // balanced ordinal month. Neither comparison clamps the requested day.
  surpasses(start: number, end: number, years: number, months: number, sign: number): boolean {
    const first = this.yearAt(start);
    const last = this.yearAt(end);
    const firstMonth = first.monthAt(start);
    const lastMonth = last.monthAt(end);
    const date = start - first.monthStart(firstMonth) + 1;
    const targetDate = end - last.monthStart(lastMonth) + 1;
    const year = first.year + years;
    const code = first.monthCodeNumber(firstMonth);
    const targetCode = last.monthCodeNumber(lastMonth);
    // M05 < M05L < M06. Encoded leap codes use 100 + month number.
    const order = code > 100 ? (code - 100) * 2 + 1 : code * 2;
    const targetOrder = targetCode > 100 ? (targetCode - 100) * 2 + 1 : targetCode * 2;
    if (
      year !== last.year
        ? sign * (year - last.year) > 0
        : order !== targetOrder
          ? sign * (order - targetOrder) > 0
          : sign * (date - targetDate) > 0
    )
      return true;
    const candidate = years === 0 ? first : this.yearFor(year);
    const month = candidate.resolveMonth(undefined, code, "constrain");
    const monthStart = this.shiftedMonth(candidate, month, months);
    const targetStart = last.monthStart(lastMonth);
    return monthStart !== targetStart
      ? sign * (monthStart - targetStart) > 0
      : sign * (date - targetDate) > 0;
  }
}
