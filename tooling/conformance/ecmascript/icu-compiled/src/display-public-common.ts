import { LocaleResolver } from "../../../../../runtime/ecmascript/src/intl/locale.ts";
import type { LocaleData } from "../../../../../runtime/ecmascript/src/intl/locale-data.ts";
import type { DisplayNamesPrimitive } from "../../../../../runtime/ecmascript/src/intl/display-data.ts";
import { NtsDisplayNames } from "../../../../../runtime/ecmascript/src/intl/display.ts";

export function displayPublic<D extends LocaleData, P extends DisplayNamesPrimitive>(
  data: D,
  open: (locale: string, type: number, style: number, dialect: boolean) => P,
): string {
  const formatter = new NtsDisplayNames(new LocaleResolver(data), open, "en-US", {
    type: "language",
  });
  return formatter.resolvedOptions().locale + ":" + formatter.of("en-US");
}
