import { epochDays, yearFromDays } from "../date/calendar.ts";
import { formatMonthCode } from "./calendar-month-code.ts";
import { QING_YEARS, CHINESE_YEARS, KOREAN_YEARS } from "./lunisolar-data.ts";

// Bounded, immutable year data. One numeric cursor serves all queries without
// month arrays, host calls or per-date allocations. The full-range strategy
// owns approximation and serial month coordinates outside these tables.
export class LunisolarTable {
  readonly #modern: Uint32Array;
  readonly #lastYear: number;
  #year = 0;
  #row = 0;
  #first = 0;
  #length = 0;
  #month = 0;
  #day = 0;
  #dayOfYear = 0;

  constructor(identifier: string) {
    if (identifier !== "chinese" && identifier !== "dangi")
      throw new RangeError("Lunisolar tables require Chinese or Korean calendar");
    this.#modern = identifier === "chinese" ? CHINESE_YEARS : KOREAN_YEARS;
    this.#lastYear = 1912 + this.#modern.length - 1;
  }

  private row(year: number): number {
    return year < 1912 ? QING_YEARS[year - 1899]! : this.#modern[year - 1912]!;
  }

  private firstDay(year: number, row: number): number {
    return epochDays(year, 0, 21) + (row >>> 17);
  }

  private yearLength(row: number): number {
    const months = ((row >>> 13) & 15) === 0 ? 12 : 13;
    let length = months * 29;
    for (let month = 0; month < months; month++) length += (row >>> month) & 1;
    return length;
  }

  load(epochDay: number): boolean {
    if (!Number.isInteger(epochDay)) return false;
    let year = this.#year;
    let row = this.#row;
    let first = this.#first;
    let yearLength = this.#length;
    if (epochDay < first || epochDay >= first + yearLength) {
      year = Math.min(yearFromDays(epochDay), this.#lastYear);
      if (year < 1899) return false;
      row = this.row(year);
      first = this.firstDay(year, row);
      if (epochDay < first) {
        year--;
        if (year < 1899) return false;
        row = this.row(year);
        first = this.firstDay(year, row);
      }
      yearLength = this.yearLength(row);
    }
    let day = epochDay - first;
    if (day >= yearLength) return false;
    const dayOfYear = day + 1;
    let month = 0;
    let length = 29 + ((row >>> month) & 1);
    while (day >= length) {
      day -= length;
      month++;
      length = 29 + ((row >>> month) & 1);
    }
    this.#year = year;
    this.#row = row;
    this.#first = first;
    this.#length = yearLength;
    this.#month = month;
    this.#day = day + 1;
    this.#dayOfYear = dayOfYear;
    return true;
  }

  field(index: number): number {
    switch (index) {
      case 0:
        return this.#year;
      case 1:
        return this.#month;
      case 2:
        return this.#day;
      case 3:
        return this.#dayOfYear;
      case 4:
        return 29 + ((this.#row >>> this.#month) & 1);
      case 5:
        return this.#length;
      case 6:
        return ((this.#row >>> 13) & 15) === 0 ? 12 : 13;
      case 7:
        return ((this.#row >>> 13) & 15) === 0 ? 0 : 1;
      default:
        return NaN;
    }
  }

  monthCode(): string {
    const leap = (this.#row >>> 13) & 15;
    const ordinal = this.#month + 1;
    return formatMonthCode(
      leap !== 0 && ordinal >= leap
        ? ordinal === leap
          ? ordinal - 1 + 100
          : ordinal - 1
        : ordinal,
    );
  }

  estimateEpochDay(year: number, ordinalMonth: number, day: number): number {
    if (
      !Number.isInteger(year) ||
      year < 1899 ||
      year > this.#lastYear ||
      !Number.isInteger(ordinalMonth) ||
      !Number.isInteger(day)
    )
      return NaN;
    const row = this.row(year);
    const months = ((row >>> 13) & 15) === 0 ? 12 : 13;
    if (
      ordinalMonth < 0 ||
      ordinalMonth >= months ||
      day < 1 ||
      day > 29 + ((row >>> ordinalMonth) & 1)
    )
      return NaN;
    let first = this.firstDay(year, row) + ordinalMonth * 29;
    for (let month = 0; month < ordinalMonth; month++) first += (row >>> month) & 1;
    return first + day - 1;
  }

  monthIndex(_year: number, _ordinalMonth: number): number {
    return NaN;
  }

  yearFromMonthIndex(_index: number): number {
    return NaN;
  }
}
