import { IcuLocaleData } from "../../../../../runtime/ecmascript/providers/icu/c/locale.ts";
import { IcuSegmenter } from "../../../../../runtime/ecmascript/providers/icu/c/segmenter.ts";
import { segmentPublic } from "./segment-public-common.ts";

export function main(): string {
  return segmentPublic(new IcuLocaleData(), (locale: string, granularity: number) =>
    IcuSegmenter.open(locale, granularity),
  );
}
