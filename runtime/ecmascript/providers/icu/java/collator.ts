import { IcuCollator as NativeCollator } from "java:nts.intl";

export class IcuCollator {
  private readonly handle: NativeCollator;
  constructor(
    locale: string,
    sensitivity: number,
    punctuation: boolean,
    numeric: boolean,
    caseFirst: number,
  ) {
    this.handle = new NativeCollator(locale, sensitivity, punctuation, numeric, caseFirst);
  }
  compare(one: string, two: string): number {
    return this.handle.compare(one, two);
  }
}
