import { disambiguate } from "../../../../../runtime/ecmascript/src/time/provider.ts";
import type { TimeZoneRules } from "../../../../../runtime/ecmascript/src/time/provider.ts";
import { NumberFormatter } from "../../../../../runtime/ecmascript/src/intl/number.ts";
import type { NumberFormatterPrimitive } from "../../../../../runtime/ecmascript/src/intl/number.ts";

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
