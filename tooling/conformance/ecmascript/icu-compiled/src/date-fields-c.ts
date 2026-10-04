import { IcuDateFormatter } from "../../../../../runtime/ecmascript/providers/icu/c/date-time.ts";
import { IcuDatePatterns } from "../../../../../runtime/ecmascript/providers/icu/c/date-pattern.ts";
import { preparedDateFields } from "./date-fields.ts";

export function main(): string {
  return preparedDateFields(
    (locale, pattern, zone) => new IcuDateFormatter(locale, pattern, zone),
    new IcuDatePatterns("en"),
  );
}
