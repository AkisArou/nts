import {
  canonicalizeLocale,
  LocaleResolver,
} from "../../../../../runtime/ecmascript/src/intl/locale.ts";
import type { LocaleData } from "../../../../../runtime/ecmascript/src/intl/locale.ts";

export function localeDigest<D extends LocaleData>(data: D): string {
  const resolver = new LocaleResolver(data);
  const chosen = resolver.numberLocale([canonicalizeLocale(data, "EN-us-u-nu-arab")], {
    numberingSystem: "latn",
  });
  return (
    canonicalizeLocale(data, "iw-BU") +
    ";" +
    canonicalizeLocale(data, "sl-rozaj-biske-1994") +
    ";" +
    canonicalizeLocale(data, "en-u-kf-yes-ca-islamicc") +
    ";" +
    data.maximize("zh-TW") +
    ";" +
    data.minimize("zh-Hant-TW") +
    ";" +
    chosen.locale +
    ";" +
    chosen.numberingSystem +
    ";" +
    resolver.numberLocale(["ar-u-nu-latn"], {}).locale
  );
}
