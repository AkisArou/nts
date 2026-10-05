import { nts_icu_string_case } from "c:nts_icu";

export function icuStringCase(locale: string, value: string, upper: boolean): string {
  const result = nts_icu_string_case(locale, value, upper);
  if (result === null) throw new Error("ICU case mapping failed");
  return result;
}
