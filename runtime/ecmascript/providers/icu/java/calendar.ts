import { IcuCalendar as NativeCalendar } from "java:nts.intl";
import { icuCalendarYear, icuExtendedYear } from "../shared/calendar-year.ts";
import {
  calendarMonthIndex,
  calendarYearFromMonthIndex,
} from "../../../src/temporal/calendar-month-index.ts";

export class IcuCalendar {
  readonly #handle: NativeCalendar;
  readonly #identifier: string;
  constructor(identifier: string) {
    this.#handle = new NativeCalendar(identifier);
    this.#identifier = identifier;
  }
  load(epochDay: number): boolean {
    return this.#handle.load(epochDay);
  }
  field(index: number): number {
    if (index % 1 !== 0 || index < 0 || index > 7) return NaN;
    const result = this.#handle.field(index);
    return index === 0 ? icuCalendarYear(this.#identifier, result) : result;
  }
  monthCode(): string {
    return this.#handle.monthCode();
  }
  estimateEpochDay(year: number, ordinalMonth: number, day: number): number {
    return this.#handle.toEpochDay(icuExtendedYear(this.#identifier, year), ordinalMonth, day);
  }
  monthIndex(year: number, ordinalMonth: number): number {
    return calendarMonthIndex(this.#identifier, year, ordinalMonth);
  }
  yearFromMonthIndex(index: number): number {
    return calendarYearFromMonthIndex(this.#identifier, index);
  }
}
