import type { ListPatternData } from "../../../../../runtime/ecmascript/src/intl/list-data.ts";
import type { DurationPatternData } from "../../../../../runtime/ecmascript/src/intl/duration-data.ts";
import type { NumberFormatterPrimitive } from "../../../../../runtime/ecmascript/src/intl/number-data.ts";
import { DurationPattern } from "../../../../../runtime/ecmascript/src/intl/duration-pattern.ts";
import { DurationConfiguration } from "../../../../../runtime/ecmascript/src/intl/duration-options.ts";
import { DurationFormatter } from "../../../../../runtime/ecmascript/src/intl/duration-format.ts";

export function durationBenchmark<
  D extends ListPatternData & DurationPatternData,
  P extends NumberFormatterPrimitive,
>(
  data: D,
  open: (locale: string, skeleton: string, negativeSkeleton: string) => P,
  iterations: number,
): number {
  const pattern = new DurationPattern(data.durationSamples("en-US"));
  const formatter = new DurationFormatter(
    data,
    open,
    "en-US",
    new DurationConfiguration({ style: "digital" }, pattern.twoDigitHours),
    pattern,
  );
  const fields = new Float64Array(10);
  fields[9] = 123_456_789;
  let checksum = 0;
  for (let index = 0; index < iterations; index++) {
    fields[4] = index % 24;
    fields[5] = index % 60;
    fields[6] = index % 60;
    checksum += formatter.format(fields, false).length;
  }
  return checksum;
}
