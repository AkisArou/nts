import type { ListPatternData } from "../../../../../runtime/ecmascript/src/intl/list-data.ts";
import type { DurationPatternData } from "../../../../../runtime/ecmascript/src/intl/duration-data.ts";
import type { NumberFormatterPrimitive } from "../../../../../runtime/ecmascript/src/intl/number-data.ts";
import { DurationPattern } from "../../../../../runtime/ecmascript/src/intl/duration-pattern.ts";
import { DurationConfiguration } from "../../../../../runtime/ecmascript/src/intl/duration-options.ts";
import { DurationFormatter } from "../../../../../runtime/ecmascript/src/intl/duration-format.ts";

// Retained separately: the compiler currently gives a literal with omitted
// optional `unit` a layout that a DurationFormatPart consumer cannot read.
export function durationParts<
  D extends ListPatternData & DurationPatternData,
  P extends NumberFormatterPrimitive,
>(data: D, open: (locale: string, skeleton: string, negativeSkeleton: string) => P): string {
  const pattern = new DurationPattern(data.durationSamples("en-US"));
  const formatter = new DurationFormatter(
    data,
    open,
    "en-US",
    new DurationConfiguration({ style: "digital" }, pattern.twoDigitHours),
    pattern,
  );
  const fields = new Float64Array(10);
  fields[6] = -1;
  fields[9] = -1;
  const parts = formatter.formatToParts(fields, true);
  let result = "";
  for (let index = 0; index < parts.length; index++) {
    const part = parts[index]!;
    result += ";" + part.type + "=" + part.value;
    if (part.type !== "literal") result += "=" + part.unit;
  }
  return result;
}
