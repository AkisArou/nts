import { LocaleResolver } from "./locale.ts";
import type { LocaleData } from "./locale-data.ts";
import { getCanonicalLocales } from "./locale-list.ts";
import { stringOption } from "./options.ts";
import type { DisplayNamesPrimitive } from "./display-data.ts";
import { DisplayNameLookup } from "./display-lookup.ts";

const matchers: readonly NonNullable<Intl.DisplayNamesOptions["localeMatcher"]>[] = [
  "lookup",
  "best fit",
];
const styles: readonly Intl.ResolvedDisplayNamesOptions["style"][] = ["long", "short", "narrow"];
const types: readonly Intl.DisplayNamesType[] = [
  "language",
  "region",
  "script",
  "currency",
  "calendar",
  "dateTimeField",
];
const fallbacks: readonly Intl.DisplayNamesFallback[] = ["code", "none"];
const displays: readonly Intl.DisplayNamesLanguageDisplay[] = ["dialect", "standard"];

export class NtsDisplayNames<D extends LocaleData, P extends DisplayNamesPrimitive>
  implements Intl.DisplayNames
{
  readonly #locale: string;
  readonly #style: Intl.ResolvedDisplayNamesOptions["style"];
  readonly #type: Intl.DisplayNamesType;
  readonly #fallback: Intl.DisplayNamesFallback;
  readonly #languageDisplay: Intl.DisplayNamesLanguageDisplay;
  readonly #lookup: DisplayNameLookup<D, P>;

  constructor(
    resolver: LocaleResolver<D>,
    open: (locale: string, type: number, style: number, dialect: boolean) => P,
    locales: Intl.LocalesArgument,
    options: Readonly<Intl.DisplayNamesOptions>,
  ) {
    const requested = getCanonicalLocales(resolver.data, locales);
    if (
      options === undefined ||
      options === null ||
      (typeof options !== "object" && typeof options !== "function")
    )
      throw new TypeError("DisplayNames requires an options object");
    const matcher = stringOption(options.localeMatcher, matchers, "best fit");
    const locale = resolver.resolve(requested, matcher).locale;
    const style = stringOption(options.style, styles, "long");
    const rawType = options.type;
    if (rawType === undefined) throw new TypeError("DisplayNames requires a type");
    const type = stringOption(rawType, types, "language");
    const fallback = stringOption(options.fallback, fallbacks, "code");
    const languageDisplay = stringOption(options.languageDisplay, displays, "dialect");
    this.#locale = locale;
    this.#style = style;
    this.#type = type;
    this.#fallback = fallback;
    this.#languageDisplay = languageDisplay;
    this.#lookup = new DisplayNameLookup(
      resolver.data,
      open(locale, types.indexOf(type), styles.indexOf(style), languageDisplay === "dialect"),
      type,
      fallback,
    );
  }
  of(code: string): string | undefined {
    return this.#lookup.of(code);
  }
  resolvedOptions(): Intl.ResolvedDisplayNamesOptions {
    return {
      locale: this.#locale,
      style: this.#style,
      type: this.#type,
      fallback: this.#fallback,
      ...(this.#type === "language" ? { languageDisplay: this.#languageDisplay } : {}),
    };
  }
}
