import { IcuLocaleData } from "../../../../../runtime/ecmascript/providers/icu/c/locale.ts";
import { IcuNumberFormatter } from "../../../../../runtime/ecmascript/providers/icu/c/number.ts";
import { durationPublic } from "./duration-public-common.ts";
export function main(): string {
  return durationPublic(
    new IcuLocaleData(),
    (locale, skeleton, negativeSkeleton) =>
      new IcuNumberFormatter(locale, skeleton, negativeSkeleton),
  );
}
