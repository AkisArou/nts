import type { CalendarPrimitive } from "./calendar-data.ts";
import { decodeMonthCode, formatMonthCode, validCalendarMonthCode } from "./calendar-month-code.ts";

// One immutable, validated year. Providers are queried only when this snapshot
// is built. Date getters and conversions use bounded scalar lookups afterward.
// The environment cache owns at most two snapshots per built-in calendar.
export class CalendarYear {
  readonly year: number;
  readonly firstDay: number;
  readonly endDay: number;
  readonly monthsInYear: number;
  readonly inLeapYear: boolean;
  readonly #identifier: string;
  readonly #starts = new Float64Array(14);
  readonly #codes = new Uint16Array(13);

  constructor(identifier: string, data: CalendarPrimitive, epochDay: number) {
    if (!data.load(epochDay)) throw new RangeError("Calendar date data is unavailable");
    const year = data.field(0);
    const dayOfYear = data.field(3);
    const leap = data.field(7);
    if (
      !Number.isInteger(year) ||
      !Number.isInteger(dayOfYear) ||
      dayOfYear < 1 ||
      dayOfYear > 400 ||
      (leap !== 0 && leap !== 1)
    )
      throw new RangeError("Invalid calendar year data");
    const first = epochDay - dayOfYear + 1;
    let day = first;
    let months = 0;
    while (months <= 13) {
      if (!data.load(day)) throw new RangeError("Calendar month data is unavailable");
      const actualYear = data.field(0);
      if (actualYear !== year) {
        if (actualYear !== year + 1 || months < 12)
          throw new RangeError("Calendar year boundaries disagree");
        break;
      }
      const length = data.field(4);
      const rawCode = data.monthCode();
      if (
        months === 13 ||
        data.field(1) !== months ||
        data.field(2) !== 1 ||
        data.field(3) !== day - first + 1 ||
        !Number.isInteger(length) ||
        length < 5 ||
        length > 31 ||
        rawCode === undefined
      )
        throw new RangeError("Invalid calendar month data");
      const code = decodeMonthCode(rawCode);
      if (!validCalendarMonthCode(identifier, code))
        throw new RangeError("Month code is invalid for calendar");
      for (let previous = 0; previous < months; previous++)
        if (this.#codes[previous] === code) throw new RangeError("Repeated calendar month code");
      this.#starts[months] = day;
      this.#codes[months] = code;
      day += length;
      months++;
    }
    if (day - first > 400 || epochDay >= day)
      throw new RangeError("Calendar date and year boundaries disagree");
    this.#starts[months] = day;
    this.year = year;
    this.firstDay = first;
    this.endDay = day;
    this.monthsInYear = months;
    this.inLeapYear = leap === 1;
    this.#identifier = identifier;
  }

  monthAt(epochDay: number): number {
    if (epochDay < this.firstDay || epochDay >= this.endDay)
      throw new RangeError("Date is outside calendar year");
    let low = 0;
    let high = this.monthsInYear;
    while (low + 1 < high) {
      const middle = Math.floor((low + high) / 2);
      if (epochDay < this.#starts[middle]!) high = middle;
      else low = middle;
    }
    return low;
  }

  monthStart(month: number): number {
    return this.#starts[month]!;
  }

  daysInMonth(month: number): number {
    return this.#starts[month + 1]! - this.#starts[month]!;
  }

  monthCode(month: number): string {
    return formatMonthCode(this.#codes[month]!);
  }

  monthCodeNumber(month: number): number {
    return this.#codes[month]!;
  }

  private codeMonth(code: number): number {
    for (let month = 0; month < this.monthsInYear; month++)
      if (this.#codes[month] === code) return month;
    return -1;
  }

  resolveMonth(
    month: number | undefined,
    code: number | undefined,
    overflow: NonNullable<Temporal.OverflowOptions["overflow"]>,
  ): number {
    if (code !== undefined) {
      if (!validCalendarMonthCode(this.#identifier, code))
        throw new RangeError("Month code is invalid for calendar");
      let ordinal = this.codeMonth(code);
      if (ordinal < 0) {
        if (overflow === "reject" || code <= 100)
          throw new RangeError("Month code does not occur in this year");
        ordinal = this.codeMonth(this.#identifier === "hebrew" ? 6 : code - 100);
      }
      if (ordinal < 0 || (month !== undefined && month !== ordinal + 1))
        throw new RangeError("Month and monthCode disagree");
      return ordinal;
    }
    if (month === undefined) throw new TypeError("Date requires month or monthCode");
    if (overflow === "constrain") return Math.max(1, Math.min(this.monthsInYear, month)) - 1;
    if (month < 1 || month > this.monthsInYear)
      throw new RangeError("Calendar month outside range");
    return month - 1;
  }

  date(
    month: number,
    day: number,
    overflow: NonNullable<Temporal.OverflowOptions["overflow"]>,
  ): number {
    const length = this.daysInMonth(month);
    if (overflow === "constrain") day = Math.max(1, Math.min(length, day));
    else if (day < 1 || day > length) throw new RangeError("Calendar day outside range");
    return this.monthStart(month) + day - 1;
  }
}
