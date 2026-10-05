import type { LocaleData } from "./locale-data.ts";
import { getCanonicalLocales } from "./locale-list.ts";
import { stringValue } from "./options.ts";

// ECMA-402 TransformCase uses only the first requested locale, after validating
// the whole list. ICU 78 tailors lower/upper casing for tr, az, lt, el and hy;
// other languages use the Unicode root mapping. No likely-subtag matching.
export function stringLocaleCase<D extends LocaleData>(
  data: D,
  mapCase: (locale: string, value: string, upper: boolean) => string,
  value: string,
  upper: boolean,
  locales: Intl.LocalesArgument = undefined,
): string {
  if (value === null || value === undefined)
    throw new TypeError("Locale casing requires a receiver");
  const text = stringValue(value);
  const requested = getCanonicalLocales(data, locales);
  const tag = requested.length === 0 ? data.defaultLocale() : requested[0]!;
  const end = tag.indexOf("-");
  const language = end < 0 ? tag : tag.slice(0, end);
  const locale =
    language === "tr" ||
    language === "az" ||
    language === "lt" ||
    language === "el" ||
    language === "hy"
      ? language
      : "und";
  return mapCase(locale, text, upper);
}
