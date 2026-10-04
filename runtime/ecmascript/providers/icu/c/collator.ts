import { nts_icu_collator_open, nts_icu_collator_compare } from "c:nts_icu";
import type { IcuCollatorHandle } from "c:nts_icu";

export class IcuCollator {
  private readonly handle: IcuCollatorHandle;
  constructor(
    locale: string,
    sensitivity: number,
    punctuation: boolean,
    numeric: boolean,
    caseFirst: number,
  ) {
    const handle = nts_icu_collator_open(locale, sensitivity, punctuation, numeric, caseFirst);
    if (handle === null) throw new RangeError("ICU collator could not be opened");
    this.handle = handle;
  }
  compare(one: string, two: string): number {
    const result = nts_icu_collator_compare(this.handle, one, two);
    if (Number.isNaN(result)) throw new RangeError("ICU string comparison failed");
    return result;
  }
}
