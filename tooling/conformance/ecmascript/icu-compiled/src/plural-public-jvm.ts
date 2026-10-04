import { IcuLocaleData } from "../../../../../runtime/ecmascript/providers/icu/java/locale.ts";
import { IcuPluralRules } from "../../../../../runtime/ecmascript/providers/icu/java/plural.ts";
import { pluralPublic } from "./plural-public-common.ts";
export function main(): string {
  return pluralPublic(
    new IcuLocaleData(),
    (locale, ordinal, skeleton, negativeSkeleton) =>
      new IcuPluralRules(locale, ordinal, skeleton, negativeSkeleton),
  );
}
