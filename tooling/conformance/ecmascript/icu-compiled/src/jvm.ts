import { IcuTimeZone } from "../../../../../runtime/ecmascript/providers/icu/java/provider.ts";
import { IcuLocaleData } from "../../../../../runtime/ecmascript/providers/icu/java/locale.ts";
import { IcuCollator } from "../../../../../runtime/ecmascript/providers/icu/java/collator.ts";
import { IcuDatePatterns } from "../../../../../runtime/ecmascript/providers/icu/java/date-pattern.ts";
import { IcuDateFormatter } from "../../../../../runtime/ecmascript/providers/icu/java/date-time.ts";
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
    timeZoneDataDigest(new IcuLocaleData())
  );
}
export function benchmark(iterations: number): number {
  return formatBenchmark(new IcuNumberFormatter("en-US", ".00##"), iterations);
}
