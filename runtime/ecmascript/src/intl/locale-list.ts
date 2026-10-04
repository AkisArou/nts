import { canonicalizeLocale, LocaleResolver } from "./locale.ts";
import type { LocaleData } from "./locale.ts";
import { LocaleIdentifier } from "./locale-id.ts";
import { NtsLocale } from "./locale-object.ts";
import { stringOption } from "./options.ts";

// Keep standard list conversion separate from scalar locale/data operations.
// Intl.LocalesArgument's canonical union needs compiler representation support;
// it must not be erased into an unchecked record to make provider probes pass.
export function getCanonicalLocales<D extends LocaleData>(
  data: D,
  locales: Intl.LocalesArgument,
): string[] {
  if (locales === undefined) return [];
  if (locales === null) throw new TypeError("Locale list must not be null");
  const list = typeof locales === "string" || !Array.isArray(locales) ? [locales] : locales;
  const seen = new Set<string>();
  const result: string[] = [];
  for (let index = 0; index < list.length; index++) {
    if (!(index in list)) continue;
    const value = list[index];
    if (value === null || (typeof value !== "string" && typeof value !== "object"))
      throw new TypeError("Locale list entries must be strings or Locale objects");
    const tag =
      value instanceof NtsLocale
        ? NtsLocale.canonicalTag(value)
        : canonicalizeLocale(data, typeof value === "string" ? value : value.toString());
    if (!seen.has(tag)) {
      seen.add(tag);
      result.push(tag);
    }
  }
  return result;
}

const matchers: readonly NonNullable<Intl.NumberFormatOptions["localeMatcher"]>[] = [
  "lookup",
  "best fit",
];
export function supportedLocalesOf<D extends LocaleData>(
  resolver: LocaleResolver<D>,
  locales: Intl.LocalesArgument,
  options?: Readonly<Pick<Intl.NumberFormatOptions, "localeMatcher">>,
): string[] {
  const requested = getCanonicalLocales(resolver.data, locales);
  if (options === null) throw new TypeError("Intl options must not be null");
  const matcher = stringOption(options?.localeMatcher, matchers, "best fit");
  const result: string[] = [];
  for (let index = 0; index < requested.length; index++) {
    const locale = requested[index]!;
    if (resolver.match(new LocaleIdentifier(locale).withoutUnicode(), matcher) !== undefined)
      result.push(locale);
  }
  return result;
}
