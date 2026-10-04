import { LocaleResolver } from "../../../../../runtime/ecmascript/src/intl/locale.ts";
import type { LocaleData } from "../../../../../runtime/ecmascript/src/intl/locale-data.ts";
import { NtsRelativeTimeFormat } from "../../../../../runtime/ecmascript/src/intl/relative.ts";
import type { RelativeTimePrimitive } from "../../../../../runtime/ecmascript/src/intl/relative-data.ts";

export function relativePublic<D extends LocaleData, P extends RelativeTimePrimitive>(
  data: D,
  open: (locale: string, style: number) => P,
): string {
  const formatter = new NtsRelativeTimeFormat(new LocaleResolver(data), open, "en-US", {
    numeric: "auto",
    numberingSystem: "latn",
  });
  const parts = formatter.formatToParts(1234.5, "days");
  return formatter.resolvedOptions().locale + ":" + formatter.format(0, "day") + ":" + parts.length;
}
