import { IcuNumberFormatter as NativeFormatter } from "java:nts.intl";
import type { NumberFormatterPrimitive } from "../../../src/intl/number.ts";

export class IcuNumberFormatter implements NumberFormatterPrimitive {
  private readonly handle: NativeFormatter;
  constructor(locale: string, skeleton: string) {
    this.handle = new NativeFormatter(locale, skeleton);
  }
  format(value: number, fields: boolean): string {
    return this.handle.format(value, fields);
  }
  formatDecimal(value: string, fields: boolean): string {
    return this.handle.formatDecimal(value, fields);
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
