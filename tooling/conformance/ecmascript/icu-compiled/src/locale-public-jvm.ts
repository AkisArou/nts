import { IcuLocaleData } from "../../../../../runtime/ecmascript/providers/icu/java/locale.ts";
import { localePublic } from "./locale-public-common.ts";

export function main(): string {
  return localePublic(new IcuLocaleData());
}
