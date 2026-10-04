import { IcuLocaleData } from "../../../../../runtime/ecmascript/providers/icu/java/locale.ts";
import { localeDigest } from "./locale-common.ts";
export function main(): string {
  return localeDigest(new IcuLocaleData());
}
