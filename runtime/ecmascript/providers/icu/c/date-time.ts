import {
  nts_icu_date_open,
  nts_icu_date_format,
  nts_icu_date_range,
  nts_icu_date_field_count,
  nts_icu_date_field,
  nts_icu_date_offset,
  nts_icu_date_calendar_fields,
} from "c:nts_icu";
import type { IcuDateHandle } from "c:nts_icu";

export class IcuDateFormatter {
  private readonly handle: IcuDateHandle;
  constructor(locale: string, pattern: string, timeZone: string) {
    const handle = nts_icu_date_open(locale, pattern, timeZone);
    if (handle === null) throw new RangeError("ICU date formatter could not be opened");
    this.handle = handle;
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
    month: number,
    leap: boolean,
    day: number,
    dayOfYear: number,
  ): void {
    if (!nts_icu_date_calendar_fields(this.handle, relatedYear, year, month, leap, day, dayOfYear))
      throw new RangeError("ICU prepared calendar fields failed");
  }
  fieldCount(): number {
    return nts_icu_date_field_count(this.handle);
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
