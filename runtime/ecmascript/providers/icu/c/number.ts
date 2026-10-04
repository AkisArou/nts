import {
  nts_icu_number_open,
  nts_icu_number_format,
  nts_icu_number_decimal,
  nts_icu_number_field_count,
  nts_icu_number_field,
  nts_icu_currency_digits,
  nts_icu_number_range_open,
  nts_icu_number_range_format,
  nts_icu_number_range_field_count,
  nts_icu_number_range_field,
} from "c:nts_icu";
import type { IcuNumberHandle, IcuNumberRangeHandle } from "c:nts_icu";

export class IcuNumberData {
  currencyDigits(currency: string): number {
    const digits = nts_icu_currency_digits(currency);
    if (!Number.isFinite(digits)) throw new RangeError("Invalid ICU currency data request");
    return digits;
  }
}

export class IcuNumberFormatter {
  private readonly positive: IcuNumberHandle;
  private readonly negative: IcuNumberHandle | null;
  private usingNegative = false;
  private usingRange = false;
  private range: IcuNumberRangeHandle | null = null;
  private ranges: (IcuNumberRangeHandle | null)[] | null = null;
  private readonly locale: string;
  private readonly skeleton: string;
  private readonly negativeSkeleton: string;
  constructor(locale: string, skeleton: string, negativeSkeleton = "") {
    const handle = nts_icu_number_open(locale, skeleton);
    if (handle === null) throw new RangeError("ICU could not create a number formatter");
    this.positive = handle;
    this.locale = locale;
    this.skeleton = skeleton;
    if (negativeSkeleton === "") this.negative = null;
    else {
      const negative = nts_icu_number_open(locale, negativeSkeleton);
      if (negative === null)
        throw new RangeError("ICU could not create a negative number formatter");
      this.negative = negative;
    }
    this.negativeSkeleton = negativeSkeleton;
  }
  format(value: number, fields: boolean, negative = false): string {
    this.usingRange = false;
    this.usingNegative = negative;
    const handle = negative && this.negative !== null ? this.negative : this.positive;
    const text = nts_icu_number_format(handle, value, fields);
    if (text === null) throw new Error("ICU number formatting failed");
    return text;
  }
  formatDecimal(value: string, fields: boolean, negative = false): string {
    this.usingRange = false;
    this.usingNegative = negative;
    const handle = negative && this.negative !== null ? this.negative : this.positive;
    const text = nts_icu_number_decimal(handle, value, fields);
    if (text === null) throw new Error("ICU decimal formatting failed");
    return text;
  }
  formatRange(
    start: string,
    end: string,
    fields: boolean,
    negativeStart = false,
    negativeEnd = false,
  ): string {
    const key = this.negativeSkeleton === "" ? 0 : (negativeStart ? 1 : 0) + (negativeEnd ? 2 : 0);
    if (this.ranges === null) this.ranges = [null, null, null, null];
    let handle: IcuNumberRangeHandle | null = this.ranges[key] ?? null;
    if (handle === null) {
      handle = nts_icu_number_range_open(
        this.locale,
        key % 2 === 1 ? this.negativeSkeleton : this.skeleton,
        key >= 2 ? this.negativeSkeleton : this.skeleton,
      );
      if (handle === null) throw new RangeError("ICU could not create a number range formatter");
      this.ranges[key] = handle;
    }
    if (this.range !== handle) this.range = handle;
    this.usingRange = true;
    const text = nts_icu_number_range_format(handle, start, end, fields);
    if (text === null) throw new Error("ICU number range formatting failed");
    return text;
  }
  fieldCount(): number {
    const range = this.range;
    const handle = this.usingNegative && this.negative !== null ? this.negative : this.positive;
    return !this.usingRange || range === null
      ? nts_icu_number_field_count(handle)
      : nts_icu_number_range_field_count(range);
  }
  field(index: number): number {
    return this.numberField(index, 0);
  }
  start(index: number): number {
    return this.numberField(index, 1);
  }
  end(index: number): number {
    return this.numberField(index, 2);
  }
  private numberField(index: number, component: number): number {
    const range = this.range;
    const handle = this.usingNegative && this.negative !== null ? this.negative : this.positive;
    return !this.usingRange || range === null
      ? nts_icu_number_field(handle, index, component)
      : nts_icu_number_range_field(range, index, component);
  }
}
