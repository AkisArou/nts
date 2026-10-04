import { IcuDatePatterns as NativePatterns } from "java:nts.intl";
import type { DateTimePatternData } from "../../../src/intl/date-time-data.ts";

export class IcuDatePatterns implements DateTimePatternData {
  private readonly handle: NativePatterns;
  constructor(locale: string) {
    this.handle = new NativePatterns(locale);
  }
  bestPattern(skeleton: string): string {
    return this.handle.bestPattern(skeleton);
  }
  stylePattern(dateStyle: number, timeStyle: number): string {
    return this.handle.stylePattern(dateStyle, timeStyle);
  }
  patterns(): string[] {
    return this.handle.patterns();
  }
}
