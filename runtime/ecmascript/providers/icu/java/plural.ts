import { IcuPluralRules as NativeRules } from "java:nts.intl";

export class IcuPluralRules {
  readonly #handle: NativeRules;
  constructor(locale: string, ordinal: boolean, skeleton: string, negativeSkeleton: string) {
    this.#handle = new NativeRules(locale, ordinal, skeleton, negativeSkeleton);
  }
  categories(): number {
    return this.#handle.categories();
  }
  select(value: number, negative: boolean): number {
    return this.#handle.select(value, negative);
  }
  selectDecimal(value: string, negative: boolean): number {
    return this.#handle.selectDecimal(value, negative);
  }
  selectRange(start: string, end: string, negativeStart: boolean, negativeEnd: boolean): number {
    return this.#handle.selectRange(start, end, negativeStart, negativeEnd);
  }
}
