import { IcuDateFormatter as NativeFormatter } from "java:nts.intl";

export class IcuDateFormatter {
  private readonly handle: NativeFormatter;
  constructor(locale: string, pattern: string, timeZone: string) {
    this.handle = new NativeFormatter(locale, pattern, timeZone);
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
    month: number,
    leap: boolean,
    day: number,
    dayOfYear: number,
  ): void {
    if (!this.handle.setCalendarFields(relatedYear, year, month, leap, day, dayOfYear))
      throw new RangeError("ICU prepared calendar fields failed");
  }
  fieldCount(): number {
    return this.handle.fieldCount();
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
