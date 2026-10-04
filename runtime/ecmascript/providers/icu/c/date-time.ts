import {
  nts_icu_date_open,
  nts_icu_date_calendar,
  nts_icu_date_format,
  nts_icu_date_range,
  nts_icu_date_field_count,
  nts_icu_date_field,
  nts_icu_date_offset,
  nts_icu_date_calendar_fields,
  nts_icu_date_field_locator,
  nts_icu_date_range_collapsed,
} from "c:nts_icu";
import type { IcuDateHandle } from "c:nts_icu";
import {
  DateFieldPatterns,
  presentationCalendar,
  presentationMonth,
} from "../shared/date-fields.ts";

export class IcuDateFormatter {
  private readonly handle: IcuDateHandle;
  readonly #calendar: string;
  readonly #monthNames: boolean;
  constructor(locale: string, pattern: string, timeZone: string) {
    const handle = nts_icu_date_open(locale, pattern, timeZone);
    if (handle === null) throw new RangeError("ICU date formatter could not be opened");
    this.handle = handle;
    const calendar = nts_icu_date_calendar(handle);
    if (calendar === null) throw new RangeError("ICU calendar identity unavailable");
    this.#calendar = presentationCalendar(calendar);
    this.#monthNames = this.#calendar === "hebrew" && new DateFieldPatterns(pattern).monthNames;
    if (pattern.includes("r")) {
      const fields = new DateFieldPatterns(pattern);
      while (fields.next())
        if (
          fields.field === 11 &&
          !nts_icu_date_field_locator(
            handle,
            fields.markerPattern(),
            fields.fieldPattern(),
            fields.markerCode(),
          )
        )
          throw new RangeError("ICU calendar field locator could not be configured");
    }
  }
  format(milliseconds: number, fields: boolean): string {
    const text = nts_icu_date_format(this.handle, milliseconds, fields);
    if (text === null) throw new RangeError("ICU date formatting failed");
    return text;
  }
  formatRange(start: number, end: number, fields: boolean): string {
    const text = nts_icu_date_range(this.handle, start, end, fields);
    if (text === null) throw new RangeError("ICU date-range formatting failed");
    return text;
  }
  offsetMilliseconds(milliseconds: number): number {
    const offset = nts_icu_date_offset(this.handle, milliseconds);
    if (!Number.isFinite(offset)) throw new RangeError("ICU date offset query failed");
    return offset;
  }
  setCalendarFields(
    relatedYear: number,
    year: number,
    era: number,
    month: number,
    monthCode: number,
    day: number,
    dayOfYear: number,
  ): void {
    const slot = presentationMonth(this.#calendar, month, monthCode, this.#monthNames);
    if (
      !nts_icu_date_calendar_fields(
        this.handle,
        relatedYear,
        year,
        era,
        slot,
        monthCode > 100,
        day,
        dayOfYear,
      )
    )
      throw new RangeError("ICU prepared calendar fields failed");
  }
  fieldCount(): number {
    return nts_icu_date_field_count(this.handle);
  }
  rangeCollapsed(): boolean {
    return nts_icu_date_range_collapsed(this.handle);
  }
  field(index: number): number {
    return nts_icu_date_field(this.handle, index, 0);
  }
  start(index: number): number {
    return nts_icu_date_field(this.handle, index, 1);
  }
  end(index: number): number {
    return nts_icu_date_field(this.handle, index, 2);
  }
}
