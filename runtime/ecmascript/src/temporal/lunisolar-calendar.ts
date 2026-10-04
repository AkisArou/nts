import type { CalendarPrimitive } from "./calendar-data.ts";
import { LunisolarCycle } from "./lunisolar-cycle.ts";
import type { CalendarYear } from "./calendar-year.ts";
import { yearFromDays } from "../date/calendar.ts";

// Accurate provider data for Chinese/Korean modern years, with a continuous,
// bounded arithmetic approximation outside them. The approximation is shared
// by runtimes; malformed wide-range ICU reversals never become public dates.
export class LunisolarCalendar {
  readonly #identifier: string;
  readonly #provider: CalendarPrimitive;
  readonly #lastYear: number;
  readonly #firstDay: number;
  readonly #endDay: number;
  #backward: LunisolarCycle | undefined;
  #forward: LunisolarCycle | undefined;
  #monthOffsets: Uint16Array | undefined;
  #usingProvider = true;
  #template: CalendarYear | undefined;
  #year = 0;
  #correction = 0;
  #correctionMonth = -1;
  #month = 0;
  #day = 0;
  #dayOfYear = 0;

  constructor(identifier: string, provider: CalendarPrimitive) {
    if (identifier !== "chinese" && identifier !== "dangi")
      throw new RangeError("Lunisolar data requires Chinese or Korean calendar");
    this.#identifier = identifier;
    this.#provider = provider;
    this.#lastYear = identifier === "chinese" ? 2100 : 2050;
    // Include complete boundary years, including dates before New Year 1900.
    const first = provider.estimateEpochDay(1899, 0, 1);
    const end = provider.estimateEpochDay(this.#lastYear + 1, 0, 1);
    if (!Number.isInteger(first) || !Number.isInteger(end) || end <= first)
      throw new RangeError("Lunisolar data boundaries are unavailable");
    this.#firstDay = first;
    this.#endDay = end;
  }

  private cycle(year: number): LunisolarCycle {
    if (year < 1899) {
      let cycle = this.#backward;
      if (cycle === undefined) {
        cycle = new LunisolarCycle(this.#identifier, this.#provider, 1899, 1899, this.#firstDay);
        this.#backward = cycle;
      }
      return cycle;
    }
    let cycle = this.#forward;
    if (cycle === undefined) {
      cycle = new LunisolarCycle(
        this.#identifier,
        this.#provider,
        this.#lastYear - 18,
        this.#lastYear + 1,
        this.#endDay,
      );
      this.#forward = cycle;
    }
    return cycle;
  }

  load(epochDay: number): boolean {
    if (!Number.isInteger(epochDay) || Math.abs(epochDay) > 100000400) return false;
    this.#usingProvider = epochDay >= this.#firstDay && epochDay < this.#endDay;
    if (this.#usingProvider) return this.#provider.load(epochDay);
    const cycle = this.cycle(epochDay < this.#firstDay ? 1898 : this.#lastYear + 1);
    let year = yearFromDays(epochDay);
    while (cycle.yearFirstDay(year) > epochDay) year--;
    while (cycle.yearFirstDay(year + 1) <= epochDay) year++;
    const template = cycle.template(year);
    const correction = cycle.correction(year);
    const correctionMonth = cycle.correctionMonth(year);
    const start = cycle.yearFirstDay(year);
    let day = epochDay - start;
    let month = 0;
    let length = template.daysInMonth(month) + (month === correctionMonth ? correction : 0);
    while (day >= length) {
      day -= length;
      month++;
      length = template.daysInMonth(month) + (month === correctionMonth ? correction : 0);
    }
    this.#template = template;
    this.#year = year;
    this.#correction = correction;
    this.#correctionMonth = correctionMonth;
    this.#month = month;
    this.#day = day + 1;
    this.#dayOfYear = epochDay - start + 1;
    return true;
  }

  field(index: number): number {
    if (this.#usingProvider) return this.#provider.field(index);
    const template = this.#template!;
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
        return (
          template.daysInMonth(this.#month) +
          (this.#month === this.#correctionMonth ? this.#correction : 0)
        );
      case 5:
        return template.endDay - template.firstDay + this.#correction;
      case 6:
        return template.monthsInYear;
      case 7:
        return template.inLeapYear ? 1 : 0;
      default:
        return NaN;
    }
  }

  monthCode(): string | undefined {
    return this.#usingProvider
      ? this.#provider.monthCode()
      : this.#template!.monthCode(this.#month);
  }

  estimateEpochDay(year: number, ordinalMonth: number, day: number): number {
    if (
      !Number.isInteger(year) ||
      Math.abs(year) > 300000 ||
      !Number.isInteger(ordinalMonth) ||
      !Number.isInteger(day)
    )
      return NaN;
    if (year >= 1899 && year <= this.#lastYear)
      return this.#provider.estimateEpochDay(year, ordinalMonth, day);
    const cycle = this.cycle(year);
    const template = cycle.template(year);
    if (ordinalMonth < 0 || ordinalMonth >= template.monthsInYear) return NaN;
    const correction = cycle.correction(year);
    const correctionMonth = cycle.correctionMonth(year);
    const length =
      template.daysInMonth(ordinalMonth) + (ordinalMonth === correctionMonth ? correction : 0);
    if (day < 1 || day > length) return NaN;
    return (
      cycle.yearFirstDay(year) +
      template.monthStart(ordinalMonth) -
      template.firstDay +
      day -
      1 +
      (correctionMonth >= 0 && ordinalMonth > correctionMonth ? correction : 0)
    );
  }

  private monthOffsets(): Uint16Array {
    let offsets = this.#monthOffsets;
    if (offsets === undefined) {
      offsets = new Uint16Array(this.#lastYear - 1899 + 2);
      for (let year = 1899; year <= this.#lastYear; year++) {
        const day = this.#provider.estimateEpochDay(year, 0, 1);
        if (
          !Number.isInteger(day) ||
          !this.#provider.load(day) ||
          this.#provider.field(0) !== year ||
          this.#provider.field(1) !== 0 ||
          this.#provider.field(2) !== 1
        )
          throw new RangeError("Lunisolar month data is unavailable");
        const months = this.#provider.field(6);
        if (months !== 12 && months !== 13) throw new RangeError("Invalid lunisolar month count");
        offsets[year - 1899 + 1] = offsets[year - 1899]! + months;
      }
      this.#monthOffsets = offsets;
    }
    return offsets;
  }

  monthIndex(year: number, ordinalMonth: number): number {
    if (year < 1899) return this.cycle(year).monthIndex(year, ordinalMonth);
    const offsets = this.monthOffsets();
    return year <= this.#lastYear
      ? offsets[year - 1899]! + ordinalMonth
      : offsets[offsets.length - 1]! + this.cycle(year).monthIndex(year, ordinalMonth);
  }

  yearFromMonthIndex(index: number): number {
    if (index < 0) return this.cycle(1898).yearFromMonthIndex(index);
    const offsets = this.monthOffsets();
    const last = offsets[offsets.length - 1]!;
    if (index >= last) return this.cycle(this.#lastYear + 1).yearFromMonthIndex(index - last);
    let low = 0;
    let high = offsets.length - 1;
    while (low + 1 < high) {
      const middle = Math.floor((low + high) / 2);
      if (index < offsets[middle]!) high = middle;
      else low = middle;
    }
    return 1899 + low;
  }
}
