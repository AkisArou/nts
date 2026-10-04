import type { ListPatternData } from "../../../../../runtime/ecmascript/src/intl/list-data.ts";
import type { DurationPatternData } from "../../../../../runtime/ecmascript/src/intl/duration-data.ts";
import type { NumberFormatterPrimitive } from "../../../../../runtime/ecmascript/src/intl/number-data.ts";
import { DurationPattern } from "../../../../../runtime/ecmascript/src/intl/duration-pattern.ts";
import { DurationConfiguration } from "../../../../../runtime/ecmascript/src/intl/duration-options.ts";
import { DurationFormatter } from "../../../../../runtime/ecmascript/src/intl/duration-format.ts";

// Physical provider/ABI witnesses supplement original Test262; public locale,
// field-bag and resolved-options acceptance has its own compiler witness.
export function durationDigest<
  D extends ListPatternData & DurationPatternData,
  P extends NumberFormatterPrimitive,
>(data: D, open: (locale: string, skeleton: string, negativeSkeleton: string) => P): string {
  const pattern = new DurationPattern(data.durationSamples("en-US"));
  const fields = new Float64Array(10);
  for (let index = 0; index < 10; index++) fields[index] = index + 1;
  const text = new DurationFormatter(
    data,
    open,
    "en-US",
    new DurationConfiguration({}, pattern.twoDigitHours),
    pattern,
  );
  let result = text.format(fields, false);
  for (let index = 0; index < 10; index++) fields[index] = -fields[index]!;
  result += "\n" + text.format(fields, true);
  fields.fill(0);
  fields[3] = 5;
  fields[4] = 1;
  fields[5] = 2;
  fields[6] = 3;
  const mixed = new DurationFormatter(
    data,
    open,
    "en-US",
    new DurationConfiguration({ minutes: "numeric", seconds: "numeric" }, pattern.twoDigitHours),
    pattern,
  );
  result += "\n" + mixed.format(fields, false);
  const digital = new DurationFormatter(
    data,
    open,
    "en-US",
    new DurationConfiguration({ style: "digital" }, pattern.twoDigitHours),
    pattern,
  );
  fields.fill(0);
  fields[6] = 10_000_000;
  fields[9] = 1;
  result += "\n" + digital.format(fields, false);
  fields.fill(0);
  // Exact binary64 integers from Test262's precision-exact-mathematical-values.
  fields[7] = 4503599627370497_000;
  fields[8] = 4503599627370495_000000;
  result += "\n" + digital.format(fields, false);
  fields.fill(0);
  fields[6] = -1;
  fields[9] = -1;
  result += "\n" + digital.format(fields, true);
  const finnishPattern = new DurationPattern(data.durationSamples("fi"));
  const finnish = new DurationFormatter(
    data,
    open,
    "fi",
    new DurationConfiguration({ style: "digital" }, finnishPattern.twoDigitHours),
    finnishPattern,
  );
  fields.fill(0);
  fields[4] = 7;
  fields[5] = 8;
  fields[6] = 9;
  result += "\n" + finnish.format(fields, false);
  const astralPattern = new DurationPattern(data.durationSamples("en-US-u-nu-mathbold"));
  const astral = new DurationFormatter(
    data,
    open,
    "en-US-u-nu-mathbold",
    new DurationConfiguration({ style: "digital" }, astralPattern.twoDigitHours),
    astralPattern,
  );
  result += "\n" + astral.format(fields, false);
  return result;
}
