import { IcuDatePatterns as NativePatterns } from "java:nts.intl";

export class IcuDatePatterns {
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
  intervalPattern(skeleton: string, field: number): string {
    return this.handle.intervalPattern(skeleton, field);
  }
  intervalFallback(): string {
    return this.handle.intervalFallback();
  }
  dateTimeConnector(dateStyle: number): string {
    return this.handle.dateTimeConnector(dateStyle);
  }
}
