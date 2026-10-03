import { disambiguate } from "../../../../../runtime/ecmascript/src/time/provider.ts";
import type { TimeZoneRules } from "../../../../../runtime/ecmascript/src/time/provider.ts";
import { NumberFormatter } from "../../../../../runtime/ecmascript/src/intl/number.ts";
import type { NumberFormatterPrimitive } from "../../../../../runtime/ecmascript/src/intl/number.ts";
import { NumberFormatConfiguration } from "../../../../../runtime/ecmascript/src/intl/number-options.ts";
import type { NumberFormatData } from "../../../../../runtime/ecmascript/src/intl/number-options.ts";

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
