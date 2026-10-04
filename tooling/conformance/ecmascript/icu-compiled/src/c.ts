import { IcuTimeZone } from "../../../../../runtime/ecmascript/providers/icu/c/provider.ts";
import { zonedTimeDigest, zonedTimeBenchmark } from "./temporal-zone.ts";
import { CachedTimeZone } from "../../../../../runtime/ecmascript/src/time/cached-zone.ts";
import { TimeZoneRegistry } from "../../../../../runtime/ecmascript/src/time/zone-id.ts";
import { timeZoneCacheAudit } from "./time-zone-cache.ts";
import { IcuLocaleData } from "../../../../../runtime/ecmascript/providers/icu/c/locale.ts";
import { IcuCollator } from "../../../../../runtime/ecmascript/providers/icu/c/collator.ts";
import { IcuDatePatterns } from "../../../../../runtime/ecmascript/providers/icu/c/date-pattern.ts";
import { IcuDateFormatter } from "../../../../../runtime/ecmascript/providers/icu/c/date-time.ts";
import { IcuRelativeFormatter } from "../../../../../runtime/ecmascript/providers/icu/c/relative.ts";
import { IcuPluralRules } from "../../../../../runtime/ecmascript/providers/icu/c/plural.ts";
import { IcuDisplayNames } from "../../../../../runtime/ecmascript/providers/icu/c/display.ts";
import { IcuSegmenter } from "../../../../../runtime/ecmascript/providers/icu/c/segmenter.ts";
import {
  IcuNumberData,
  IcuNumberFormatter,
} from "../../../../../runtime/ecmascript/providers/icu/c/number.ts";
import {
  digest,
  numberDigest,
  numberOptionsDigest,
  numberRangeDigest,
  localeDataDigest,
  localePreferenceDigest,
  localePreferenceBenchmark,
  collatorDigest,
  datePatternDigest,
  dateTextDigest,
  timeZoneDataDigest,
  supportedValuesDigest,
  supportedValuesBenchmark,
  displayDigest,
  segmentDigest,
  segmentBenchmark,
  displayBenchmark,
  listDigest,
  listBenchmark,
  relativeDigest,
  pluralDigest,
  pluralBenchmark,
  formatBenchmark,
} from "./common.ts";
// These fixture inputs are already IANA primary identifiers.
function cachedPrimaryZone(id: string): CachedTimeZone<IcuTimeZone> {
  return new CachedTimeZone(new IcuTimeZone(id), id, id);
}
export function main(): string {
  const rawTime = zonedTimeDigest(
    new IcuTimeZone("America/New_York"),
    new IcuTimeZone("Australia/Lord_Howe"),
    new IcuTimeZone("Pacific/Apia"),
    new IcuTimeZone("America/Havana"),
    new IcuTimeZone("Africa/Monrovia"),
  );
  const cachedTime = zonedTimeDigest(
    cachedPrimaryZone("America/New_York"),
    cachedPrimaryZone("Australia/Lord_Howe"),
    cachedPrimaryZone("Pacific/Apia"),
    cachedPrimaryZone("America/Havana"),
    cachedPrimaryZone("Africa/Monrovia"),
  );
  if (rawTime !== cachedTime) throw new Error("Cached time-zone data differs from its provider");
  return (
    digest(new IcuTimeZone("America/New_York")) +
    "\n" +
    cachedTime +
    "\ntemporal-zone-cache:" +
    auditCachedTimeZones() +
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
    localePreferenceDigest(new IcuLocaleData()) +
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
    supportedValuesDigest(new IcuLocaleData()) +
    "\n" +
    segmentDigest((locale: string, granularity: number) => IcuSegmenter.open(locale, granularity)) +
    "\n" +
    displayDigest(
      new IcuLocaleData(),
      (locale, type, style, dialect) => new IcuDisplayNames(locale, type, style, dialect),
    ) +
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
export function auditCachedTimeZones(): string {
  const names = new TimeZoneRegistry(new IcuLocaleData()).primaryIdentifiers();
  let comparisons = 0;
  for (let index = 0; index < names.length; index++) {
    const zone = new IcuTimeZone(names[index]!);
    comparisons += timeZoneCacheAudit(zone, new CachedTimeZone(zone, names[index]!, names[index]!));
  }
  return names.length + ":" + comparisons;
}
export function benchmark(iterations: number): number {
  return formatBenchmark(new IcuNumberFormatter("en-US", ".00##"), iterations);
}
export function benchmarkZonedTime(
  iterations: number,
  ambiguous: boolean,
  cached: boolean,
  advancing: boolean,
): number {
  if (cached)
    return zonedTimeBenchmark(
      cachedPrimaryZone("America/New_York"),
      iterations,
      ambiguous,
      advancing,
    );
  return zonedTimeBenchmark(new IcuTimeZone("America/New_York"), iterations, ambiguous, advancing);
}
export function benchmarkLocale(iterations: number, cached: boolean): number {
  return localePreferenceBenchmark(new IcuLocaleData(), iterations, cached);
}
export function benchmarkSegment(iterations: number, containing: boolean, wide: boolean): number {
  return segmentBenchmark(IcuSegmenter.open("en-US", 1), iterations, containing, wide);
}
export function benchmarkSupported(iterations: number, timeZones: boolean): number {
  return supportedValuesBenchmark(new IcuLocaleData(), iterations, timeZones);
}
export function benchmarkDisplay(iterations: number, fields: boolean): number {
  return displayBenchmark(
    new IcuLocaleData(),
    new IcuDisplayNames("en-US", fields ? 5 : 3, 0, true),
    iterations,
    fields,
  );
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
