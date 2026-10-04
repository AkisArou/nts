import { IcuDateFormatter as NativeFormatter } from "java:nts.intl";
import {
  DateFieldPatterns,
  presentationCalendar,
  presentationMonth,
} from "../shared/date-fields.ts";

export class IcuDateFormatter {
  private readonly handle: NativeFormatter;
  readonly #calendar: string;
  readonly #monthNames: boolean;
  constructor(locale: string, pattern: string, timeZone: string) {
    this.handle = new NativeFormatter(locale, pattern, timeZone);
    this.#calendar = presentationCalendar(this.handle.calendarType());
    this.#monthNames = this.#calendar === "hebrew" && new DateFieldPatterns(pattern).monthNames;
    if (pattern.includes("r") || pattern.includes("U")) {
      const fields = new DateFieldPatterns(pattern);
      this.handle.setYearNameOnly(fields.yearNameOnly);
      while (fields.next())
        if (fields.field !== 12 || !fields.yearNameOnly)
          this.handle.addFieldLocator(
            fields.markerPattern(),
            fields.fieldPattern(),
            fields.markerCode(),
            fields.field,
          );
    }
  }
  format(milliseconds: number, fields: boolean): string {
    return this.handle.format(milliseconds, fields);
  }
  formatRange(start: number, end: number, fields: boolean): string {
    return this.handle.formatRange(start, end, fields);
  }
  offsetMilliseconds(milliseconds: number): number {
    return this.handle.offsetMilliseconds(milliseconds);
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
      !this.handle.setCalendarFields(relatedYear, year, era, slot, monthCode > 100, day, dayOfYear)
    )
      throw new RangeError("ICU prepared calendar fields failed");
  }
  fieldCount(): number {
    return this.handle.fieldCount();
  }
  rangeCollapsed(): boolean {
    return this.handle.rangeCollapsed();
  }
  field(index: number): number {
    return this.handle.field(index);
  }
  start(index: number): number {
    return this.handle.start(index);
  }
  end(index: number): number {
    return this.handle.end(index);
  }
}
