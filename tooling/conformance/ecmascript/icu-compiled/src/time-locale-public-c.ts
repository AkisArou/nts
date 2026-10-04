import { IcuLocaleData } from "../../../../../runtime/ecmascript/providers/icu/c/locale.ts";
import { IcuDatePatterns } from "../../../../../runtime/ecmascript/providers/icu/c/date-pattern.ts";
import { IcuDateFormatter } from "../../../../../runtime/ecmascript/providers/icu/c/date-time.ts";
import { IcuNumberFormatter } from "../../../../../runtime/ecmascript/providers/icu/c/number.ts";
import { LocaleResolver } from "../../../../../runtime/ecmascript/src/intl/locale.ts";
import { TimeZoneRegistry } from "../../../../../runtime/ecmascript/src/time/zone-id.ts";
import { TimeLocaleContext } from "../../../../../runtime/ecmascript/src/intl/time-locale.ts";
import { timeLocalePublic } from "./time-locale-public-common.ts";

export function main(): string {
  const data = new IcuLocaleData();
  return timeLocalePublic(
    new TimeLocaleContext(
      new LocaleResolver(data),
      new TimeZoneRegistry(data),
      (locale) => new IcuDatePatterns(locale),
      (locale, pattern, zone) => new IcuDateFormatter(locale, pattern, zone),
      (locale, skeleton, negativeSkeleton) =>
        new IcuNumberFormatter(locale, skeleton, negativeSkeleton),
      () => 0,
    ),
  );
}
