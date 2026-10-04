import { disambiguate } from "../../../../../runtime/ecmascript/src/time/provider.ts";
import type { TimeZoneRules } from "../../../../../runtime/ecmascript/src/time/provider.ts";
import { NumberFormatter } from "../../../../../runtime/ecmascript/src/intl/number.ts";
import type { NumberFormatterPrimitive } from "../../../../../runtime/ecmascript/src/intl/number.ts";
import { NumberFormatConfiguration } from "../../../../../runtime/ecmascript/src/intl/number-options.ts";
import type { NumberFormatData } from "../../../../../runtime/ecmascript/src/intl/number-options.ts";
import type { LocaleInfoData } from "../../../../../runtime/ecmascript/src/intl/locale-data.ts";
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
    data.hourCycle("en-US") +
    ";" +
    data.hourCycle("en-GB") +
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
