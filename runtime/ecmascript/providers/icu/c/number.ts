import {
  nts_icu_number_open,
  nts_icu_number_format,
  nts_icu_number_decimal,
  nts_icu_number_field_count,
  nts_icu_number_field,
  nts_icu_currency_digits,
} from "c:nts_icu";
import type { IcuNumberHandle } from "c:nts_icu";
import type { NumberFormatterPrimitive } from "../../../src/intl/number.ts";
import type { NumberFormatData } from "../../../src/intl/number-options.ts";

export class IcuNumberData implements NumberFormatData {
  currencyDigits(currency: string): number {
    const digits = nts_icu_currency_digits(currency);
    if (!Number.isFinite(digits)) throw new RangeError("Invalid ICU currency data request");
    return digits;
  }
}

export class IcuNumberFormatter implements NumberFormatterPrimitive {
  private readonly handle: IcuNumberHandle;
  constructor(locale: string, skeleton: string) {
    const handle = nts_icu_number_open(locale, skeleton);
    if (handle === null) throw new RangeError("ICU could not create a number formatter");
    this.handle = handle;
  }
  format(value: number, fields: boolean): string {
    const text = nts_icu_number_format(this.handle, value, fields);
    if (text === null) throw new Error("ICU number formatting failed");
    return text;
  }
  formatDecimal(value: string, fields: boolean): string {
    const text = nts_icu_number_decimal(this.handle, value, fields);
    if (text === null) throw new Error("ICU decimal formatting failed");
    return text;
  }
  fieldCount(): number {
    return nts_icu_number_field_count(this.handle);
  }
  field(index: number): number {
    return nts_icu_number_field(this.handle, index, 0);
  }
  start(index: number): number {
    return nts_icu_number_field(this.handle, index, 1);
  }
  end(index: number): number {
    return nts_icu_number_field(this.handle, index, 2);
  }
}
