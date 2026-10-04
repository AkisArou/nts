import { IcuLocaleData } from "../../../../../runtime/ecmascript/providers/icu/java/locale.ts";
import { IcuNumberFormatter } from "../../../../../runtime/ecmascript/providers/icu/java/number.ts";
import { durationParts } from "./duration-parts.ts";
export function main(): string {
  return durationParts(
    new IcuLocaleData(),
    (locale, skeleton, negativeSkeleton) =>
      new IcuNumberFormatter(locale, skeleton, negativeSkeleton),
  );
}
