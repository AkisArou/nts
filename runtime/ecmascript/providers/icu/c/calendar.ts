import {
  nts_icu_calendar_open,
  nts_icu_calendar_load,
  nts_icu_calendar_field,
  nts_icu_calendar_month_code,
  nts_icu_calendar_to_day,
} from "c:nts_icu";
import type { IcuCalendarHandle } from "c:nts_icu";
import { icuCalendarYear, icuExtendedYear } from "../shared/calendar-year.ts";
import {
  calendarMonthIndex,
  calendarYearFromMonthIndex,
} from "../../../src/temporal/calendar-month-index.ts";

export class IcuCalendar {
  readonly #handle: IcuCalendarHandle;
  readonly #identifier: string;
  constructor(identifier: string) {
    const handle = nts_icu_calendar_open(identifier);
    if (handle === null) throw new RangeError("ICU calendar could not be opened");
    this.#handle = handle;
    this.#identifier = identifier;
  }
  load(epochDay: number): boolean {
    return nts_icu_calendar_load(this.#handle, epochDay);
  }
  field(index: number): number {
    const result = nts_icu_calendar_field(this.#handle, index);
    return index === 0 ? icuCalendarYear(this.#identifier, result) : result;
  }
  monthCode(): string | undefined {
    const code = nts_icu_calendar_month_code(this.#handle);
    return code === null ? undefined : code;
  }
  estimateEpochDay(year: number, ordinalMonth: number, day: number): number {
    return nts_icu_calendar_to_day(
      this.#handle,
      icuExtendedYear(this.#identifier, year),
      ordinalMonth,
      day,
    );
  }
  monthIndex(year: number, ordinalMonth: number): number {
    return calendarMonthIndex(this.#identifier, year, ordinalMonth);
  }
  yearFromMonthIndex(index: number): number {
    return calendarYearFromMonthIndex(this.#identifier, index);
  }
}
