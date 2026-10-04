import {
  nts_icu_plural_open,
  nts_icu_plural_categories,
  nts_icu_plural_select,
  nts_icu_plural_decimal,
  nts_icu_plural_range,
} from "c:nts_icu";
import type { IcuPluralHandle } from "c:nts_icu";
import type { PluralRulesPrimitive } from "../../../src/intl/plural-data.ts";

export class IcuPluralRules implements PluralRulesPrimitive {
  readonly #handle: IcuPluralHandle;
  constructor(locale: string, ordinal: boolean, skeleton: string, negativeSkeleton: string) {
    const handle = nts_icu_plural_open(locale, ordinal, skeleton, negativeSkeleton);
    if (handle === null) throw new RangeError("ICU could not create plural rules");
    this.#handle = handle;
  }
  categories(): number {
    return nts_icu_plural_categories(this.#handle);
  }
  select(value: number, negative: boolean): number {
    return nts_icu_plural_select(this.#handle, value, negative);
  }
  selectDecimal(value: string, negative: boolean): number {
    return nts_icu_plural_decimal(this.#handle, value, negative);
  }
  selectRange(start: string, end: string, negativeStart: boolean, negativeEnd: boolean): number {
    return nts_icu_plural_range(this.#handle, start, end, negativeStart, negativeEnd);
  }
}
