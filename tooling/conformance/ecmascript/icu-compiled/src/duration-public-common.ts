import { LocaleResolver } from "../../../../../runtime/ecmascript/src/intl/locale.ts";
import type { LocaleData } from "../../../../../runtime/ecmascript/src/intl/locale-data.ts";
import type { ListPatternData } from "../../../../../runtime/ecmascript/src/intl/list-data.ts";
import type { DurationPatternData } from "../../../../../runtime/ecmascript/src/intl/duration-data.ts";
import type { NumberFormatterPrimitive } from "../../../../../runtime/ecmascript/src/intl/number-data.ts";
import { NtsDurationFormat } from "../../../../../runtime/ecmascript/src/intl/duration.ts";

export function durationPublic<
  D extends LocaleData & ListPatternData & DurationPatternData,
  P extends NumberFormatterPrimitive,
>(data: D, open: (locale: string, skeleton: string, negativeSkeleton: string) => P): string {
  const formatter = new NtsDurationFormat(new LocaleResolver(data), open, "en-US", {
    style: "digital",
  });
  return (
    formatter.resolvedOptions().locale +
    ":" +
    formatter.format({ seconds: 10_000_000, nanoseconds: 1 })
  );
}
