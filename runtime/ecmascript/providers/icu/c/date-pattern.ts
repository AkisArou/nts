import {
  nts_icu_date_patterns_open,
  nts_icu_date_best_pattern,
  nts_icu_date_style_pattern,
  nts_icu_date_patterns,
} from "c:nts_icu";
import type { IcuDatePatternHandle } from "c:nts_icu";

function required(pattern: string | null): string {
  if (pattern === null) throw new RangeError("ICU date-pattern operation failed");
  return pattern;
}
export class IcuDatePatterns {
  private readonly handle: IcuDatePatternHandle;
  constructor(locale: string) {
    const handle = nts_icu_date_patterns_open(locale);
    if (handle === null) throw new RangeError("ICU date patterns could not be opened");
    this.handle = handle;
  }
  bestPattern(skeleton: string): string {
    return required(nts_icu_date_best_pattern(this.handle, skeleton));
  }
  stylePattern(dateStyle: number, timeStyle: number): string {
    return required(nts_icu_date_style_pattern(this.handle, dateStyle, timeStyle));
  }
  patterns(): string[] {
    const patterns = nts_icu_date_patterns(this.handle);
    if (patterns === null) throw new RangeError("ICU date patterns could not be enumerated");
    return patterns;
  }
}
