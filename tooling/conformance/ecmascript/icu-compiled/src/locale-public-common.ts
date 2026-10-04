import { NtsLocale } from "../../../../../runtime/ecmascript/src/intl/locale-object.ts";
import type { LocaleInfoData } from "../../../../../runtime/ecmascript/src/intl/locale-data.ts";

export function localePublic<D extends LocaleInfoData>(data: D): string {
  const locale = new NtsLocale(data, "en-JP-u-rg-zzzzzz-fw-mon");
  return (
    locale.toString() +
    ":" +
    locale.getCalendars().join(",") +
    ":" +
    locale.getHourCycles().join(",") +
    ":" +
    locale.getWeekInfo().firstDay +
    ":" +
    locale.getTimeZones()?.join(",")
  );
}
