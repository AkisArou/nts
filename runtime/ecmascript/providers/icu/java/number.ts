import { IcuNumberFormatter as NativeFormatter } from "java:nts.intl";
import { IcuNumberData as NativeData } from "java:nts.intl";
import type { NumberFormatterPrimitive } from "../../../src/intl/number.ts";
import type { NumberFormatData } from "../../../src/intl/number-options.ts";

export class IcuNumberData implements NumberFormatData {
  private readonly handle = new NativeData();
  currencyDigits(currency: string): number {
    return this.handle.currencyDigits(currency);
  }
}

export class IcuNumberFormatter implements NumberFormatterPrimitive {
  private readonly handle: NativeFormatter;
  constructor(locale: string, skeleton: string, negativeSkeleton = "") {
    this.handle = new NativeFormatter(locale, skeleton, negativeSkeleton);
  }
  format(value: number, fields: boolean, negative = false): string {
    return this.handle.format(value, fields, negative);
  }
  formatDecimal(value: string, fields: boolean, negative = false): string {
    return this.handle.formatDecimal(value, fields, negative);
  }
  formatRange(
    start: string,
    end: string,
    fields: boolean,
    negativeStart = false,
    negativeEnd = false,
  ): string {
    return this.handle.formatRange(start, end, fields, negativeStart, negativeEnd);
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
