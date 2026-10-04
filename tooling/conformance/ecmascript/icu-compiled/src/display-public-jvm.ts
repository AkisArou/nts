import { IcuLocaleData } from "../../../../../runtime/ecmascript/providers/icu/java/locale.ts";
import { IcuDisplayNames } from "../../../../../runtime/ecmascript/providers/icu/java/display.ts";
import { displayPublic } from "./display-public-common.ts";

export function main(): string {
  return displayPublic(
    new IcuLocaleData(),
    (locale, type, style, dialect) => new IcuDisplayNames(locale, type, style, dialect),
  );
}
