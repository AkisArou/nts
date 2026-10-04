import { IcuLocaleData } from "../../../../../runtime/ecmascript/providers/icu/java/locale.ts";
import { IcuNumberFormatter } from "../../../../../runtime/ecmascript/providers/icu/java/number.ts";
import { durationDigest } from "./duration-common.ts";
import { durationBenchmark } from "./duration-benchmark.ts";
export function main(): string {
  return durationDigest(
    new IcuLocaleData(),
    (locale, skeleton, negativeSkeleton) =>
      new IcuNumberFormatter(locale, skeleton, negativeSkeleton),
  );
}
export function benchmarkDuration(iterations: number): number {
  return durationBenchmark(
    new IcuLocaleData(),
    (locale, skeleton, negativeSkeleton) =>
      new IcuNumberFormatter(locale, skeleton, negativeSkeleton),
    iterations,
  );
}
