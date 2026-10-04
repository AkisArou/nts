import {
  nts_icu_segment_open,
  nts_icu_segment_text,
  nts_icu_segment_boundary,
  nts_icu_segment_status,
} from "c:nts_icu";
import type { IcuSegmentHandle } from "c:nts_icu";
import type { SegmenterPrimitive } from "../../../src/intl/segment-data.ts";

export class IcuSegmenter implements SegmenterPrimitive<IcuSegmenter> {
  readonly #handle: IcuSegmentHandle;
  private constructor(handle: IcuSegmentHandle) {
    this.#handle = handle;
  }

  static open(locale: string, granularity: number): IcuSegmenter {
    const handle = nts_icu_segment_open(locale, granularity);
    if (handle === null) throw new Error("ICU segmenter could not be opened");
    return new IcuSegmenter(handle);
  }
  forText(input: string): IcuSegmenter {
    const handle = nts_icu_segment_text(this.#handle, input);
    if (handle === null) throw new Error("ICU segmentation text could not be opened");
    return new IcuSegmenter(handle);
  }
  next(): number {
    return nts_icu_segment_boundary(this.#handle, 0, 0);
  }
  previous(): number {
    return nts_icu_segment_boundary(this.#handle, 0, 2);
  }
  following(index: number): number {
    return nts_icu_segment_boundary(this.#handle, index, 1);
  }
  ruleStatus(): number {
    return nts_icu_segment_status(this.#handle);
  }
}
