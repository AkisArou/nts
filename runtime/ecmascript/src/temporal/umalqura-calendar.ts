import type { CalendarPrimitive } from "./calendar-data.ts";
import { ArithmeticCalendar } from "./arithmetic-calendar.ts";

// The specified Umm al-Qura table covers years 1300..1600. Outside it the
// calendar is exactly islamic-civil, including negative years. Keep that rule
// here rather than relying on a provider's wide-range field setters.
export class UmmAlQuraCalendar {
  readonly #provider: CalendarPrimitive;
  readonly #civil = new ArithmeticCalendar("islamic-civil");
  readonly #firstDay: number;
  readonly #endDay: number;
  #usingCivil = false;

  constructor(provider: CalendarPrimitive) {
    const first = provider.estimateEpochDay(1300, 0, 1);
    const end = provider.estimateEpochDay(1601, 0, 1);
    if (
      !Number.isInteger(first) ||
      !Number.isInteger(end) ||
      end <= first ||
      first !== this.#civil.estimateEpochDay(1300, 0, 1) ||
      end !== this.#civil.estimateEpochDay(1601, 0, 1)
    )
      throw new RangeError("Umm al-Qura table boundaries are invalid");
    this.#provider = provider;
    this.#firstDay = first;
    this.#endDay = end;
  }

  load(epochDay: number): boolean {
    this.#usingCivil = epochDay < this.#firstDay || epochDay >= this.#endDay;
    return this.#usingCivil ? this.#civil.load(epochDay) : this.#provider.load(epochDay);
  }

  field(index: number): number {
    return this.#usingCivil ? this.#civil.field(index) : this.#provider.field(index);
  }

  monthCode(): string | undefined {
    return this.#usingCivil ? this.#civil.monthCode() : this.#provider.monthCode();
  }

  estimateEpochDay(year: number, ordinalMonth: number, day: number): number {
    return year < 1300 || year > 1600
      ? this.#civil.estimateEpochDay(year, ordinalMonth, day)
      : this.#provider.estimateEpochDay(year, ordinalMonth, day);
  }

  monthIndex(year: number, ordinalMonth: number): number {
    return year * 12 + ordinalMonth;
  }

  yearFromMonthIndex(index: number): number {
    return Math.floor(index / 12);
  }
}
