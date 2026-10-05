import { IcuCaseMapping } from "java:nts.intl";

export function icuStringCase(locale: string, value: string, upper: boolean): string {
  return IcuCaseMapping.mapCase(locale, value, upper);
}
