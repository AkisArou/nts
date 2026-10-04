import { IcuTimeZone } from "../../../../../runtime/ecmascript/providers/icu/java/provider.ts";
import { IcuLocaleData } from "../../../../../runtime/ecmascript/providers/icu/java/locale.ts";
import { IcuCollator } from "../../../../../runtime/ecmascript/providers/icu/java/collator.ts";
import { IcuDatePatterns } from "../../../../../runtime/ecmascript/providers/icu/java/date-pattern.ts";
import { IcuDateFormatter } from "../../../../../runtime/ecmascript/providers/icu/java/date-time.ts";
import { IcuRelativeFormatter } from "../../../../../runtime/ecmascript/providers/icu/java/relative.ts";
import { IcuPluralRules } from "../../../../../runtime/ecmascript/providers/icu/java/plural.ts";
import {
  IcuNumberData,
  IcuNumberFormatter,
} from "../../../../../runtime/ecmascript/providers/icu/java/number.ts";
import {
  digest,
  numberDigest,
  numberOptionsDigest,
  numberRangeDigest,
  localeDataDigest,
  collatorDigest,
  datePatternDigest,
  dateTextDigest,
  timeZoneDataDigest,
  listDigest,
  listBenchmark,
  relativeDigest,
  pluralDigest,
  pluralBenchmark,
  formatBenchmark,
} from "./common.ts";
export function main(): string {
  return (
    digest(new IcuTimeZone("America/New_York")) +
    "\n" +
    numberDigest(new IcuNumberFormatter("en-US", ".00##")) +
    "\n" +
    numberDigest(new IcuNumberFormatter("en-US-u-nu-mathbold", ".00##")) +
    "\n" +
    numberOptionsDigest(
      new IcuNumberData(),
      (skeleton) => new IcuNumberFormatter("en-US", skeleton),
    ) +
    "\n" +
    numberRangeDigest(
      new IcuNumberData(),
      (skeleton, negativeSkeleton) => new IcuNumberFormatter("en-US", skeleton, negativeSkeleton),
    ) +
    "\n" +
    localeDataDigest(new IcuLocaleData()) +
    "\n" +
    collatorDigest(
      new IcuLocaleData(),
      (locale, sensitivity, punctuation, numeric, caseFirst) =>
        new IcuCollator(locale, sensitivity, punctuation, numeric, caseFirst),
    ) +
    "\n" +
    datePatternDigest(new IcuDatePatterns("en-US")) +
    "\n" +
    dateTextDigest((locale, pattern, timeZone) => new IcuDateFormatter(locale, pattern, timeZone)) +
    "\n" +
    timeZoneDataDigest(new IcuLocaleData()) +
    "\n" +
    listDigest(new IcuLocaleData()) +
    "\n" +
    relativeDigest((locale, style) => new IcuRelativeFormatter(locale, style)) +
    "\n" +
    pluralDigest(
      (locale, ordinal, skeleton, negativeSkeleton) =>
        new IcuPluralRules(locale, ordinal, skeleton, negativeSkeleton),
    )
  );
}
export function benchmark(iterations: number): number {
  return formatBenchmark(new IcuNumberFormatter("en-US", ".00##"), iterations);
}
export function benchmarkList(iterations: number, count: number): number {
  return listBenchmark(new IcuLocaleData(), iterations, count);
}
export function benchmarkPlural(iterations: number, range: boolean): number {
  return pluralBenchmark(
    new IcuPluralRules("pl", false, ".### rounding-mode-half-up group-off", ""),
    iterations,
    range,
  );
}
