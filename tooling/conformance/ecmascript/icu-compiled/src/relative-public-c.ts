import { IcuLocaleData } from "../../../../../runtime/ecmascript/providers/icu/c/locale.ts";
import { IcuRelativeFormatter } from "../../../../../runtime/ecmascript/providers/icu/c/relative.ts";
import { relativePublic } from "./relative-public-common.ts";
export function main(): string {
  return relativePublic(
    new IcuLocaleData(),
    (locale, style) => new IcuRelativeFormatter(locale, style),
  );
}
