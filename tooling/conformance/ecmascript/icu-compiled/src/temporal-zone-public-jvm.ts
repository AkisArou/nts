import { Instant } from "../../../../../runtime/ecmascript/src/temporal/builtins.ts";
import { TimeZoneRegistry } from "../../../../../runtime/ecmascript/src/time/zone-id.ts";
import { TimeZoneContext } from "../../../../../runtime/ecmascript/src/time/zone-source.ts";
import { IcuTimeZone } from "../../../../../runtime/ecmascript/providers/icu/java/provider.ts";
import { IcuLocaleData } from "../../../../../runtime/ecmascript/providers/icu/java/locale.ts";

export function main(): string {
  const zones = new TimeZoneContext(
    new TimeZoneRegistry(new IcuLocaleData()),
    (id) => new IcuTimeZone(id),
  );
  return new Instant(0n).toString({ timeZone: "Asia/Kolkata" }, zones);
}

export function format(value: bigint, options: Readonly<Temporal.InstantToStringOptions>): string {
  const zones = new TimeZoneContext(
    new TimeZoneRegistry(new IcuLocaleData()),
    (id) => new IcuTimeZone(id),
  );
  return new Instant(value).toString(options, zones);
}
