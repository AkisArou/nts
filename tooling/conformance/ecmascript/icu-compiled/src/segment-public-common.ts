import { LocaleResolver } from "../../../../../runtime/ecmascript/src/intl/locale.ts";
import type { LocaleData } from "../../../../../runtime/ecmascript/src/intl/locale-data.ts";
import type { SegmenterPrimitive } from "../../../../../runtime/ecmascript/src/intl/segment-data.ts";
import { NtsSegmenter } from "../../../../../runtime/ecmascript/src/intl/segmenter.ts";

export function segmentPublic<D extends LocaleData, P extends SegmenterPrimitive<P>>(
  data: D,
  open: (locale: string, granularity: number) => P,
): string {
  const segmenter = new NtsSegmenter(new LocaleResolver(data), open, "en-US", {
    granularity: "word",
  });
  const segments = segmenter.segment("Hello, 世界!");
  const first = segments.containing(0)!;
  const iterator = segments[Symbol.iterator]();
  const next = iterator.next();
  if (next.done) throw new Error("Expected a segment");
  return (
    segmenter.resolvedOptions().granularity +
    ":" +
    first.segment +
    ":" +
    first.isWordLike +
    ":" +
    next.value.index
  );
}
