import { disambiguate } from "../../../../../runtime/ecmascript/src/time/provider.ts";
import type { TimeZoneRules } from "../../../../../runtime/ecmascript/src/time/provider.ts";
import { NumberFormatter } from "../../../../../runtime/ecmascript/src/intl/number.ts";
import type { NumberFormatterPrimitive } from "../../../../../runtime/ecmascript/src/intl/number-data.ts";
import { NumberFormatConfiguration } from "../../../../../runtime/ecmascript/src/intl/number-options.ts";
import type { NumberFormatData } from "../../../../../runtime/ecmascript/src/intl/number-data.ts";
import type { LocaleInfoData } from "../../../../../runtime/ecmascript/src/intl/locale-data.ts";
import { LocaleIdentifier } from "../../../../../runtime/ecmascript/src/intl/locale-id.ts";
import { LocalePreferences } from "../../../../../runtime/ecmascript/src/intl/locale-preference.ts";
import type { SupportedValueData } from "../../../../../runtime/ecmascript/src/intl/supported-value-data.ts";
import { SupportedValues } from "../../../../../runtime/ecmascript/src/intl/supported-values.ts";
import { TimeZoneRegistry } from "../../../../../runtime/ecmascript/src/time/zone-id.ts";
import type { DisplayNamesPrimitive } from "../../../../../runtime/ecmascript/src/intl/display-data.ts";
import { DisplayNameLookup } from "../../../../../runtime/ecmascript/src/intl/display-lookup.ts";
import type { SegmenterPrimitive } from "../../../../../runtime/ecmascript/src/intl/segment-data.ts";
import { SegmentBoundaries } from "../../../../../runtime/ecmascript/src/intl/segment-boundaries.ts";
import type { CollationData } from "../../../../../runtime/ecmascript/src/intl/locale-data.ts";
import type { CollatorPrimitive } from "../../../../../runtime/ecmascript/src/intl/collation.ts";
import type { DateTimePatternData } from "../../../../../runtime/ecmascript/src/intl/date-time-data.ts";
import type { DateTimeFormatterPrimitive } from "../../../../../runtime/ecmascript/src/intl/date-time-data.ts";
import { DateTimeFormatter } from "../../../../../runtime/ecmascript/src/intl/date-time.ts";
import type { TimeZoneIdentifierData } from "../../../../../runtime/ecmascript/src/time/zone-data.ts";
import {
  offsetTimeZoneMinutes,
  formatOffsetTimeZone,
} from "../../../../../runtime/ecmascript/src/time/offset-zone-id.ts";
import {
  DateTimePattern,
  basicDateTimePattern,
  dateTimeSkeleton,
} from "../../../../../runtime/ecmascript/src/intl/date-pattern.ts";
import { ListPatterns } from "../../../../../runtime/ecmascript/src/intl/list-pattern.ts";
import type { ListPatternData } from "../../../../../runtime/ecmascript/src/intl/list-data.ts";
import type { RelativeTimePrimitive } from "../../../../../runtime/ecmascript/src/intl/relative-data.ts";
import {
  relativeAuto,
  relativeUnit,
} from "../../../../../runtime/ecmascript/src/intl/relative-unit.ts";
import { RelativePartBuffer } from "../../../../../runtime/ecmascript/src/intl/relative-parts.ts";
import { FieldSpans } from "../../../../../runtime/ecmascript/src/intl/parts.ts";
import { NumberDigits } from "../../../../../runtime/ecmascript/src/intl/number-digits.ts";
import type { PluralRulesPrimitive } from "../../../../../runtime/ecmascript/src/intl/plural-data.ts";
import {
  pluralCategory,
  pluralCategories,
} from "../../../../../runtime/ecmascript/src/intl/plural-category.ts";

export function segmentBenchmark<P extends SegmenterPrimitive<P>>(
  primitive: P,
  iterations: number,
  containing: boolean,
  wide: boolean,
): number {
  const input = (wide ? "Hi! 👩‍👩‍👧‍👦 日本語\r\n" : "Hello, café!\r\n").repeat(24);
  let checksum = 0;
  if (containing) {
    const boundaries = new SegmentBoundaries(primitive.forText(input), input);
    for (let index = 0; index < iterations; index++) {
      boundaries.find((index * 7919) % input.length);
      checksum += boundaries.start + boundaries.end + (boundaries.wordLike ? 1 : 0);
    }
  } else {
    for (let index = 0; index < iterations; index++) {
      const boundaries = new SegmentBoundaries(primitive.forText(input), input);
      while (boundaries.advance())
        checksum += boundaries.start + boundaries.end + (boundaries.wordLike ? 1 : 0);
    }
  }
  return checksum;
}

export function pluralDigest<P extends PluralRulesPrimitive>(
  open: (locale: string, ordinal: boolean, skeleton: string, negativeSkeleton: string) => P,
): string {
  const digits = new NumberDigits<Readonly<Intl.NumberFormatOptions>>({}, 0, 3, "standard");
  const english = open("en-US", false, digits.skeleton() + " group-off", "");
  let result =
    pluralCategories(english.categories()).join(",") +
    ":" +
    pluralCategory(english.select(1, false)) +
    ":" +
    pluralCategory(english.select(1.0004, false)) +
    ":" +
    pluralCategory(english.select(1.0009, false));
  result +=
    ":" +
    pluralCategory(english.selectRange("1.0001", "1.0002", false, false)) +
    ":" +
    pluralCategory(english.selectRange("-1", "1", false, false));
  const ordinal = open("en-US", true, digits.skeleton() + " group-off", "");
  result += "\n" + pluralCategories(ordinal.categories()).join(",");
  for (const number of [0, 1, 2, 3, 4, 11, 21])
    result += ":" + pluralCategory(ordinal.select(number, false));
  result +=
    ":" +
    pluralCategory(ordinal.selectRange("1", "1", false, false)) +
    ":" +
    pluralCategory(ordinal.selectRange("1", "2", false, false));
  const padded = new NumberDigits<Readonly<Intl.NumberFormatOptions>>(
    { minimumFractionDigits: 2 },
    0,
    3,
    "standard",
  );
  const stripped = new NumberDigits<Readonly<Intl.NumberFormatOptions>>(
    { minimumFractionDigits: 2, trailingZeroDisplay: "stripIfInteger" },
    0,
    3,
    "standard",
  );
  result +=
    "\n" +
    pluralCategory(open("en-US", false, padded.skeleton(), "").select(1, false)) +
    ":" +
    pluralCategory(open("en-US", false, stripped.skeleton(), "").select(1, false));
  const russian = open("ru", false, digits.skeleton() + " group-off", "");
  result +=
    "\n" +
    pluralCategory(russian.selectDecimal("9007199254740991", false)) +
    ":" +
    pluralCategory(russian.selectDecimal("9007199254740993", false));
  const compact = new NumberDigits<Readonly<Intl.NumberFormatOptions>>({}, 0, 3, "compact");
  const french = open("fr", false, "compact-short " + compact.skeleton(), "");
  result +=
    "\n" +
    pluralCategory(french.select(1e6, false)) +
    ":" +
    pluralCategory(french.select(1.5e6, false)) +
    ":" +
    pluralCategory(french.select(1e-6, false));
  const rounding = new NumberDigits<Readonly<Intl.NumberFormatOptions>>(
    { maximumFractionDigits: 0, roundingMode: "halfCeil" },
    0,
    3,
    "standard",
  );
  const half = open("en-US", false, rounding.skeleton(), rounding.skeleton(true));
  result +=
    "\n" +
    pluralCategory(half.select(-1.5, true)) +
    ":" +
    pluralCategory(half.select(1.5, false)) +
    ":" +
    pluralCategory(half.selectRange("-1.5", "-1.1", true, true));
  result +=
    "\n" +
    pluralCategory(english.selectRange("Infinity", "Infinity", false, false)) +
    ":" +
    pluralCategory(english.selectRange("Infinity", "1", false, false));
  return result;
}

export function pluralBenchmark<P extends PluralRulesPrimitive>(
  rules: P,
  iterations: number,
  range: boolean,
): number {
  let checksum = 0;
  if (range) {
    for (let index = 0; index < iterations; index++)
      checksum += rules.selectRange(String(index % 100), String((index + 1) % 100), false, false);
  } else {
    for (let index = 0; index < iterations; index++) checksum += rules.select(index % 100, false);
  }
  return checksum;
}

export function relativeDigest<P extends RelativeTimePrimitive>(
  open: (locale: string, style: number) => P,
): string {
  const english = open("en-US-u-nu-latn", 0);
  const code = relativeUnit("days");
  let result = english.format(-0, code, false, false) + ":" + english.format(0, code, false, false);
  result += ":" + english.format(0, code, relativeAuto(0, "auto"), false);
  result += ":" + english.format(0.001, code, relativeAuto(0.001, "auto"), false);
  result += ":" + english.format(0.999, code, relativeAuto(0.999, "auto"), false);
  const text = english.format(1234.5, code, false, true);
  const spans = new FieldSpans(english.fieldCount());
  spans.count = english.fieldCount();
  for (let index = 0; index < spans.count; index++) {
    spans.fields[index] = english.field(index);
    spans.starts[index] = english.start(index);
    spans.ends[index] = english.end(index);
  }
  const parts = new RelativePartBuffer().partition(text, spans, "day");
  result += "\n" + text;
  for (let index = 0; index < parts.length; index++) {
    const part = parts[index]!;
    result += ";" + part.type + "=" + part.value;
    if (part.type !== "literal") result += "=" + part.unit;
  }
  result += "\n" + open("pl-PL-u-nu-latn", 0).format(1000, code, false, false);
  const digits = open("en-US-u-nu-mathbold", 0);
  result += "\n" + digits.format(12.5, code, false, true);
  for (let index = 0; index < digits.fieldCount(); index++)
    if (digits.field(index) !== 14)
      result += ";" + digits.field(index) + "=" + digits.start(index) + ":" + digits.end(index);
  return result;
}

export function listDigest<D extends ListPatternData>(data: D): string {
  const english = new ListPatterns(data, "en-US", 0, 0);
  // Construct the unpaired UTF-16 unit at runtime: the separately recorded
  // frontend literal transport defect must not substitute three U+FFFDs here.
  const parts = english.formatToParts(["😀", "", String.fromCharCode(0xd800)]);
  let result = english.format(["A", "", "B"]);
  for (let index = 0; index < parts.length; index++) {
    const part = parts[index]!;
    result += ";" + part.type + "=" + part.value.length;
  }
  const spanish = new ListPatterns(data, "es", 0, 0);
  const or = new ListPatterns(data, "es", 1, 0);
  const hebrew = new ListPatterns(data, "he", 0, 0);
  const maori = new ListPatterns(data, "mi", 1, 0);
  return (
    result +
    "\n" +
    spanish.format(["A", "iglesia"]) +
    ":" +
    spanish.format(["A", "hielo"]) +
    ":" +
    or.format(["A", "11"]) +
    ":" +
    or.format(["A", "110"]) +
    "\n" +
    hebrew.format(["A", "ב"]) +
    ":" +
    hebrew.format(["A", "😀"]) +
    "\n" +
    maori.format(["A", "B", "C", "D"])
  );
}

export function listBenchmark<D extends ListPatternData>(
  data: D,
  iterations: number,
  count: number,
): number {
  const formatter = new ListPatterns(data, "en-US", 0, 0);
  const items = new Array<string>(count);
  for (let index = 0; index < count; index++) items[index] = String(index);
  let checksum = 0;
  for (let index = 0; index < iterations; index++) {
    items[0] = String(index);
    checksum += formatter.format(items).length;
  }
  return checksum;
}

export function dateTextDigest<P extends DateTimeFormatterPrimitive>(
  open: (locale: string, pattern: string, timeZone: string) => P,
): string {
  const formatter = new DateTimeFormatter(
    open("en-US-u-ca-gregory", "yyyy-MM-dd HH:mm:ss.SSS '😀' z", "America/New_York"),
  );
  const parts = formatter.formatToParts(0);
  let result = formatter.format(1710055800000);
  for (let index = 0; index < parts.length; index++) {
    const part = parts[index]!;
    result += ";" + part.type + "=" + part.value;
  }
  const iso = new DateTimeFormatter(open("en-US-u-ca-gregory", "yyyy-MM-dd G", "UTC"));
  result +=
    "\n" +
    iso.format(-12219724800000) +
    ":" +
    iso.format(-62167219200000) +
    ":" +
    iso.format(-8640000000000000) +
    ":" +
    iso.format(8640000000000000);
  const digits = new DateTimeFormatter(
    open("en-US-u-ca-gregory-nu-mathbold", "yyyy-MM-dd", "+05:30"),
  );
  const digitParts = digits.formatToParts(0);
  result += "\n" + digits.format(0);
  for (let index = 0; index < digitParts.length; index++) {
    const part = digitParts[index]!;
    result += ";" + part.type + "=" + part.value;
  }
  const chinese = new DateTimeFormatter(open("en-US-u-ca-chinese", "r(U) MMMM d", "UTC"));
  const chineseParts = chinese.formatToParts(1549324800000);
  result += "\n" + chinese.format(1549324800000);
  for (let index = 0; index < chineseParts.length; index++) {
    const part = chineseParts[index]!;
    result += ";" + part.type + "=" + part.value;
  }
  const range = new DateTimeFormatter(open("en-US", "MMM d, y", "UTC"));
  result += "\n" + range.formatRange(0, 172800000);
  const rangeParts = range.formatRangeToParts(0, 172800000);
  for (let index = 0; index < rangeParts.length; index++) {
    const part = rangeParts[index]!;
    result += ";" + part.type + "=" + part.value + "=" + part.source;
  }
  result += "\n" + range.formatRange(0, 3600000);
  const identityParts = range.formatRangeToParts(0, 3600000);
  for (let index = 0; index < identityParts.length; index++) {
    const part = identityParts[index]!;
    result += ";" + part.type + "=" + part.value + "=" + part.source;
  }
  return result;
}

export function timeZoneDataDigest<D extends TimeZoneIdentifierData>(data: D): string {
  return (
    data.canonicalTimeZone("US/Eastern") +
    ":" +
    data.timeZoneNames().includes("UTC") +
    ":" +
    (data.canonicalTimeZone(data.defaultTimeZoneIdentifier()) !== undefined) +
    ":" +
    formatOffsetTimeZone(offsetTimeZoneMinutes("-04")!) +
    ":" +
    formatOffsetTimeZone(offsetTimeZoneMinutes("+0530")!) +
    ":" +
    formatOffsetTimeZone(offsetTimeZoneMinutes("-00:00")!)
  );
}

export function supportedValuesDigest<
  D extends LocaleInfoData & SupportedValueData & TimeZoneIdentifierData,
>(data: D): string {
  const zones = new TimeZoneRegistry(data);
  const supported = new SupportedValues(data, zones);
  const keys: readonly Parameters<typeof Intl.supportedValuesOf>[0][] = [
    "calendar",
    "collation",
    "currency",
    "numberingSystem",
    "timeZone",
    "unit",
  ];
  let result = "";
  for (let index = 0; index < keys.length; index++) {
    const values = supported.of(keys[index]!);
    let ordered = true;
    for (let at = 1; at < values.length; at++) if (values[at - 1]! >= values[at]!) ordered = false;
    const text = values.join(",");
    let checksum = 2166136261;
    for (let at = 0; at < text.length; at++) checksum = (checksum * 31 + text.charCodeAt(at)) >>> 0;
    const first = values[0]!;
    values[0] = "mutated";
    const fresh = supported.of(keys[index]!)[0] === first;
    result +=
      (index === 0 ? "" : "\n") +
      keys[index] +
      ":" +
      values.length +
      ":" +
      checksum +
      ":" +
      ordered +
      ":" +
      fresh;
  }
  return (
    result +
    "\n" +
    zones.primaryIdentifier("europe/kiev") +
    ":" +
    zones.primaryIdentifier("Asia/Calcutta") +
    ":" +
    zones.primaryIdentifier("Europe/Bratislava") +
    ":" +
    zones.primaryIdentifier("Europe/Prague") +
    ":" +
    zones.primaryIdentifier("Atlantic/Jan_Mayen") +
    ":" +
    zones.primaryIdentifier("Etc/GMT") +
    ":" +
    zones.primaryIdentifier("Etc/GMT+1") +
    ":" +
    zones.resolve("europe/kiev")
  );
}

export function supportedValuesBenchmark<
  D extends LocaleInfoData & SupportedValueData & TimeZoneIdentifierData,
>(data: D, iterations: number, timeZones: boolean): number {
  const supported = new SupportedValues(data, new TimeZoneRegistry(data));
  const key = timeZones ? "timeZone" : "numberingSystem";
  supported.of(key);
  let checksum = 0;
  for (let index = 0; index < iterations; index++) {
    const values = supported.of(key);
    checksum += values[index % values.length]!.charCodeAt(0);
  }
  return checksum;
}

export function displayBenchmark<D extends LocaleInfoData, P extends DisplayNamesPrimitive>(
  data: D,
  primitive: P,
  iterations: number,
  fields: boolean,
): number {
  const lookup = new DisplayNameLookup(
    data,
    primitive,
    fields ? "dateTimeField" : "currency",
    "none",
  );
  const codes = fields
    ? [
        "era",
        "year",
        "quarter",
        "month",
        "weekOfYear",
        "weekday",
        "day",
        "dayPeriod",
        "hour",
        "minute",
        "second",
        "timeZoneName",
      ]
    : ["USD", "EUR", "JPY"];
  for (let index = 0; index < codes.length; index++) lookup.of(codes[index]!);
  let checksum = 0;
  for (let index = 0; index < iterations; index++)
    checksum += lookup.of(codes[index % codes.length]!)!.length;
  return checksum;
}

export function displayDigest<D extends LocaleInfoData, P extends DisplayNamesPrimitive>(
  data: D,
  open: (locale: string, type: number, style: number, dialect: boolean) => P,
): string {
  const dialect = new DisplayNameLookup(data, open("en-US", 0, 0, true), "language", "code");
  const standard = new DisplayNameLookup(data, open("en-US", 0, 0, false), "language", "none");
  let result =
    dialect.of("EN-us") +
    ":" +
    standard.of("en-US") +
    ":" +
    dialect.of("iw") +
    ":" +
    standard.of("zzzzz");
  const region = new DisplayNameLookup(data, open("en-US", 1, 1, true), "region", "none");
  result += "\n" + region.of("us") + ":" + region.of("XX");
  const script = new DisplayNameLookup(data, open("en-US", 2, 0, true), "script", "none");
  result += "\n" + script.of("hans") + ":" + script.of("HANT") + ":" + script.of("Qaaa");
  const currency = new DisplayNameLookup(data, open("en-US", 3, 0, true), "currency", "none");
  const fallback = new DisplayNameLookup(data, open("en-US", 3, 0, true), "currency", "code");
  result +=
    "\n" +
    currency.of("usd") +
    ":" +
    currency.of("XXX") +
    ":" +
    currency.of("XZZ") +
    ":" +
    fallback.of("xzz");
  const calendar = new DisplayNameLookup(data, open("en-US", 4, 0, true), "calendar", "code");
  result +=
    "\n" +
    calendar.of("GREGORY") +
    ":" +
    calendar.of("islamicc") +
    ":" +
    calendar.of("ethiopic-amete-alem") +
    ":" +
    calendar.of("FOOBAR");
  const fields = [
    "era",
    "year",
    "quarter",
    "month",
    "weekOfYear",
    "weekday",
    "day",
    "dayPeriod",
    "hour",
    "minute",
    "second",
    "timeZoneName",
  ];
  for (let style = 0; style < 3; style++) {
    const names = new DisplayNameLookup(
      data,
      open("en-US", 5, style, true),
      "dateTimeField",
      "none",
    );
    result += "\n";
    for (let index = 0; index < fields.length; index++)
      result += (index === 0 ? "" : ",") + names.of(fields[index]!);
    result += ":" + names.of("month");
  }
  return result;
}

export function segmentDigest<P extends SegmenterPrimitive<P>>(
  open: (locale: string, granularity: number) => P,
): string {
  const texts = [
    "á\r\n👩‍👩‍👧‍👦🇬🇷B",
    "Hello, 世界! 123カタカナไทยภาษา",
    "One. Two?\r\nThird! 😀",
    "A" + String.fromCharCode(0, 233, 0xd800) + "B" + String.fromCharCode(0xdc00),
    "é".repeat(513) + " x",
  ];
  let result = "";
  for (let sample = 0; sample < texts.length; sample++) {
    const input = texts[sample]!;
    const granularity = sample === 1 || sample === 4 ? 1 : sample === 2 ? 2 : 0;
    const source = open(sample === 1 ? "th" : "en-US", granularity);
    const first = new SegmentBoundaries(source.forText(input), input);
    const second = new SegmentBoundaries(source.forText(input), input);
    const search = new SegmentBoundaries(source.forText(input), input);
    const forward = new SegmentBoundaries(source.forText(input), input);
    let checksum = 0;
    let count = 0;
    let boundaries = "";
    while (first.advance()) {
      if (
        !second.advance() ||
        first.start !== second.start ||
        first.end !== second.end ||
        first.wordLike !== second.wordLike
      )
        throw new Error("Independent segment cursors disagree");
      boundaries += (count === 0 ? "" : ",") + first.start + ":" + first.end + ":" + first.wordLike;
      for (let index = first.end - 1; index >= first.start; index--) {
        if (
          !search.find(index) ||
          search.start !== first.start ||
          search.end !== first.end ||
          search.wordLike !== first.wordLike
        )
          throw new Error("Containing and sequential boundaries disagree");
        checksum += search.start * 31 + search.end + (search.wordLike ? 1 : 0);
      }
      count++;
      for (let index = first.start; index < first.end; index++) {
        if (
          !forward.find(index) ||
          forward.start !== first.start ||
          forward.end !== first.end ||
          forward.wordLike !== first.wordLike
        )
          throw new Error("Forward containing boundaries disagree");
      }
    }
    if (first.advance() || second.advance() || search.find(-1) || search.find(input.length))
      throw new Error("Invalid segmentation exhaustion/index");
    result +=
      (sample === 0 ? "" : "\n") +
      "segments:" +
      sample +
      ":" +
      count +
      ":" +
      checksum +
      ":" +
      boundaries;
  }
  return result;
}

export function datePatternDigest<P extends DateTimePatternData>(data: P): string {
  const skeleton = dateTimeSkeleton(
    {
      year: "numeric",
      month: "long",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      fractionalSecondDigits: 3,
      timeZoneName: "shortGeneric",
    },
    "h23",
  );
  const matched = new DateTimePattern(data.bestPattern(skeleton));
  const fields = matched.components;
  const style = new DateTimePattern(data.stylePattern(3, 3));
  const available = data.patterns().sort();
  const candidates = new Array<DateTimePattern>(available.length);
  for (let index = 0; index < available.length; index++)
    candidates[index] = new DateTimePattern(available[index]!);
  const basic = basicDateTimePattern(
    { year: "numeric", month: "long", day: "numeric" },
    candidates,
  ).components;
  return (
    skeleton +
    ":" +
    fields.year +
    ":" +
    fields.month +
    ":" +
    fields.day +
    ":" +
    fields.hour +
    ":" +
    fields.minute +
    ":" +
    fields.second +
    ":" +
    fields.fractionalSecondDigits +
    ":" +
    fields.timeZoneName +
    ":" +
    new DateTimePattern(matched.withHourCycle("h24")).hourCycle +
    ":" +
    style.components.year +
    ":" +
    style.hourCycle +
    ":" +
    basic.year +
    ":" +
    basic.month +
    ":" +
    basic.day
  );
}

export function collatorDigest<D extends CollationData, P extends CollatorPrimitive>(
  data: D,
  open: (
    locale: string,
    sensitivity: number,
    punctuation: boolean,
    numeric: boolean,
    caseFirst: number,
  ) => P,
): string {
  const base = open("en-US", 0, false, false, 0);
  const numeric = open("en-US", 3, false, true, 0);
  const upper = open("en-US", 3, false, false, 1);
  const punctuation = open("en-US", 3, true, false, 0);
  return (
    data.collationDefaults("en-US") +
    ":" +
    data.collationDefaults("th-TH") +
    ":" +
    base.compare("ä", "a") +
    ":" +
    base.compare("é", "e\u0301") +
    ":" +
    numeric.compare("2", "10") +
    ":" +
    upper.compare("A", "a") +
    ":" +
    punctuation.compare("a-b", "ab") +
    ":" +
    numeric.compare("\u{10400}", "\u{10401}") +
    ":" +
    numeric.compare("\ud800a", "\ud800b") +
    ":" +
    numeric.compare("a\u0000b", "a\u0000c") +
    ":" +
    base.compare("a", "α")
  );
}

export function localeDataDigest<D extends LocaleInfoData>(data: D): string {
  return (
    data.calendarValues("th-TH").join(",") +
    ";" +
    data.collationValues("de-DE").join(",") +
    ";" +
    data.hourCycleValues("en-US").join(",") +
    ";" +
    data.hourCycleValues("en-GB").join(",") +
    ";" +
    data.timeZones("JP").join(",") +
    ";" +
    data.weekData("US") +
    ";" +
    data.weekData("GB") +
    ";" +
    data.textDirection("Arab") +
    ";" +
    data.textDirection("Latn") +
    ";" +
    data.textDirection("Zzzz")
  );
}

export function localePreferenceDigest<D extends LocaleInfoData>(data: D): string {
  const tags = [
    "fa-JP-u-rg-thzzzz-sd-inka",
    "fa-JP-u-sd-inka",
    "fa-u-sd-inka",
    "fa",
    "eo",
    "fa-IN-u-rg-zzzzzz",
    "en-US-u-rg-grzzzz",
    "en-JP",
    "en-001",
    "und-001",
    "fr-CA",
    "en-CA",
    "en-SA",
    "en-US-u-ca-foobar-hc-foobar",
  ];
  let result = "";
  for (let index = 0; index < tags.length; index++) {
    const preferences = new LocalePreferences(
      data,
      new LocaleIdentifier(data.canonicalize(tags[index]!)),
    );
    const calendars = preferences.calendars(),
      hours = preferences.hourCycles();
    const expectedCalendars = calendars.join(","),
      expectedHours = hours.join(",");
    calendars[0] = "mutated";
    hours[0] = "mutated";
    if (
      preferences.calendars().join(",") !== expectedCalendars ||
      preferences.hourCycles().join(",") !== expectedHours
    )
      throw new Error("Locale preference cache escaped");
    result +=
      (index === 0 ? "" : "\n") +
      "locale:" +
      tags[index] +
      ":" +
      expectedCalendars +
      ";" +
      expectedHours +
      ";" +
      preferences.weekData();
  }
  const regions = ["UA", "IN", "SK", "CZ", "NO", "AX", "ZZ", "001"];
  for (let index = 0; index < regions.length; index++)
    result +=
      "\nlocale-zones:" + regions[index] + ":" + data.timeZones(regions[index]!).sort().join(",");
  return result;
}

export function localePreferenceBenchmark<D extends LocaleInfoData>(
  data: D,
  iterations: number,
  cached: boolean,
): number {
  const preferences = new LocalePreferences(data, new LocaleIdentifier("en-JP"));
  let checksum = 0;
  for (let index = 0; index < iterations; index++) {
    checksum += cached
      ? preferences.calendars().length + preferences.hourCycles().length + preferences.weekData()
      : data.calendarValues("en-JP").length +
        data.hourCycleValues("en-JP").length +
        data.weekData("JP");
  }
  return checksum;
}

export function gap(zone: TimeZoneRules): number {
  return disambiguate(1710037800000, zone, "compatible"); // 2024-03-10 02:30 local
}
export function overlap(zone: TimeZoneRules): number {
  return disambiguate(1730597400000, zone, "compatible"); // 2024-11-03 01:30 local
}
export function digest(zone: TimeZoneRules): string {
  return (
    zone.id +
    ":" +
    zone.offsetMilliseconds(0) +
    ":" +
    gap(zone) +
    ":" +
    overlap(zone) +
    ":" +
    zone.transition(1704067200000, true)
  );
}
export function numberDigest<P extends NumberFormatterPrimitive>(primitive: P): string {
  const formatter = new NumberFormatter(primitive);
  const parts = formatter.formatToParts(-12345.678);
  let text = formatter.formatDecimal("900719925474099312345");
  for (let i = 0; i < parts.length; i++) text += ";" + parts[i]!.type + "=" + parts[i]!.value;
  return text;
}
export function formatBenchmark<P extends NumberFormatterPrimitive>(
  primitive: P,
  iterations: number,
): number {
  const formatter = new NumberFormatter(primitive);
  let checksum = 0;
  for (let i = 0; i < iterations; i++) checksum += formatter.format(i + 0.125).length;
  return checksum;
}

export function numberRangeDigest<D extends NumberFormatData, P extends NumberFormatterPrimitive>(
  data: D,
  open: (skeleton: string, negativeSkeleton: string) => P,
): string {
  const currency = new NumberFormatConfiguration(data, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
  const money = new NumberFormatter(open(currency.skeleton(), ""));
  const parts = money.formatRangeToParts("3", "5");
  let result = money.formatRange("1", "1");
  for (let index = 0; index < parts.length; index++) {
    const part = parts[index]!;
    result += ";" + part.type + "=" + part.value + "=" + part.source;
  }
  const options = new NumberFormatConfiguration(data, {
    roundingMode: "halfCeil",
    maximumFractionDigits: 0,
    signDisplay: "never",
  });
  const half = new NumberFormatter(open(options.skeleton(), options.skeleton(true)), false, true);
  result +=
    "\n" + half.format(-1.5) + ":" + half.format(1.5) + ":" + half.formatRange("-0.01", "0.01");
  const decimal = new NumberFormatConfiguration(data, {});
  result +=
    "\n" +
    new NumberFormatter(open(decimal.skeleton(), "")).formatRange(
      "987654321987654321",
      "987654321987654322",
    );
  return result;
}

// Exercise shared library option layouts through both foreign ABIs. These are
// provider integration probes; original Test262 owns semantic conformance.
export function numberOptionsDigest<D extends NumberFormatData, P extends NumberFormatterPrimitive>(
  data: D,
  open: (skeleton: string) => P,
): string {
  const percent = new NumberFormatConfiguration(data, {
    style: "percent",
    maximumFractionDigits: 1,
    signDisplay: "exceptZero",
    useGrouping: false,
  });
  const cash = new NumberFormatConfiguration(data, {
    style: "currency",
    currency: "usd",
    currencySign: "accounting",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
    roundingIncrement: 5,
  });
  const yen = new NumberFormatConfiguration(data, { style: "currency", currency: "JPY" });
  const dinar = new NumberFormatConfiguration(data, { style: "currency", currency: "KWD" });
  const compact = new NumberFormatConfiguration(data, { notation: "compact" });
  const unit = new NumberFormatConfiguration(data, {
    style: "unit",
    unit: "meter-per-second",
    unitDisplay: "long",
    maximumFractionDigits: 1,
  });
  const precise = new NumberFormatConfiguration(data, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
    minimumSignificantDigits: 2,
    maximumSignificantDigits: 3,
    roundingPriority: "morePrecision",
    trailingZeroDisplay: "stripIfInteger",
    roundingMode: "halfEven",
    minimumIntegerDigits: 3,
  });
  const ignored = new NumberFormatConfiguration(data, {
    minimumFractionDigits: NaN,
    maximumSignificantDigits: 2,
  });
  const less = new NumberFormatConfiguration(data, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
    maximumSignificantDigits: 2,
    roundingPriority: "lessPrecision",
  });
  const unknown = new NumberFormatConfiguration(data, { style: "currency", currency: "ZZZ" });
  return (
    new NumberFormatter(open(percent.skeleton())).format(0.01255) +
    "\n" +
    new NumberFormatter(open(cash.skeleton())).format(-1.025) +
    "\n" +
    new NumberFormatter(open(yen.skeleton())).format(1234.5) +
    "\n" +
    new NumberFormatter(open(dinar.skeleton())).format(1.2345) +
    "\n" +
    new NumberFormatter(open(compact.skeleton())).format(1234.5) +
    "\n" +
    new NumberFormatter(open(unit.skeleton())).format(12.35) +
    "\n" +
    new NumberFormatter(open(precise.skeleton())).format(1) +
    "\n" +
    new NumberFormatter(open(ignored.skeleton())).format(12.55) +
    "\n" +
    new NumberFormatter(open(less.skeleton())).format(0.09945) +
    "\n" +
    new NumberFormatter(open(unknown.skeleton())).format(1.234)
  );
}
