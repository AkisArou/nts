import { IcuSegmenter as NativeSegmenter } from "java:nts.intl";

export class IcuSegmenter {
  readonly #handle: NativeSegmenter;
  private constructor(handle: NativeSegmenter) {
    this.#handle = handle;
  }

  static open(locale: string, granularity: number): IcuSegmenter {
    return new IcuSegmenter(new NativeSegmenter(locale, granularity));
  }
  forText(input: string): IcuSegmenter {
    return new IcuSegmenter(this.#handle.forText(input));
  }
  next(): number {
    return this.#handle.next();
  }
  previous(): number {
    return this.#handle.previous();
  }
  following(index: number): number {
    return this.#handle.following(index);
  }
  ruleStatus(): number {
    return this.#handle.ruleStatus();
  }
}
