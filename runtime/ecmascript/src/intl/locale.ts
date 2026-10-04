import { LocaleIdentifier, validUnicodeType } from "./locale-id.ts";
import { optionalString, stringOption } from "./options.ts";
import type { LocaleData } from "./locale-data.ts";
export type { LocaleData } from "./locale-data.ts";

// Data/likely-subtag operations, not ECMAScript option or list semantics.
// One provider/resolver belongs to the environment and is reused by services.
const matchers: readonly NonNullable<Intl.NumberFormatOptions["localeMatcher"]>[] = [
  "lookup",
  "best fit",
];

export function canonicalizeLocale<D extends LocaleData>(data: D, tag: string): string {
  if (typeof tag !== "string") throw new TypeError("Locale identifiers must be strings");
  const identifier = new LocaleIdentifier(tag);
  let result = data.canonicalize(tag);
  const keywords = identifier.unicodeKeywords();
  for (let index = 0; index < keywords.length; index++) {
    const entry = keywords[index]!;
    // ICU's tag writer treats "yes" as boolean for every key. UTS 35 only
    // applies that alias where the pinned key/type data actually declares it.
    if (entry.value === "yes" && data.canonicalType(entry.key, entry.value) !== "true")
      result = new LocaleIdentifier(result).withKeyword(entry.key, entry.value);
  }
  return result;
}

export class NumberLocale implements Pick<
  Intl.ResolvedNumberFormatOptions,
  "locale" | "numberingSystem"
> {
  readonly locale: string;
  readonly numberingSystem: string;
  // The formatter's data locale includes explicit options even when the public
  // resolved locale must omit the overridden Unicode extension.
  readonly dataLocale: string;
  constructor(locale: string, numberingSystem: string, dataLocale: string) {
    this.locale = locale;
    this.numberingSystem = numberingSystem;
    this.dataLocale = dataLocale;
  }
}

export class LocaleSelection {
  readonly locale: string;
  readonly requested: LocaleIdentifier | undefined;
  constructor(locale: string, requested?: LocaleIdentifier) {
    this.locale = locale;
    this.requested = requested;
  }
}

export class LocaleResolver<D extends LocaleData> {
  readonly data: D;
  private readonly available = new Set<string>();
  constructor(data: D) {
    const count = data.availableCount();
    for (let index = 0; index < count; index++) {
      const locale = data.availableLocale(index);
      if (locale !== "und") this.available.add(locale);
    }
    this.data = data;
  }

  private lookup(tag: string): string | undefined {
    let candidate = tag;
    while (true) {
      if (this.available.has(candidate)) return candidate;
      let last = candidate.lastIndexOf("-");
      if (last < 0) return undefined;
      if (last >= 2 && candidate.charAt(last - 2) === "-") last -= 2;
      candidate = candidate.slice(0, last);
    }
  }

  match(
    tag: string,
    matcher: NonNullable<Intl.NumberFormatOptions["localeMatcher"]>,
  ): string | undefined {
    return matcher === "lookup" ? this.lookup(tag) : this.data.bestFit(tag);
  }

  resolve(
    requested: readonly string[],
    matcher: NonNullable<Intl.CollatorOptions["localeMatcher"]>,
  ): LocaleSelection {
    for (let index = 0; index < requested.length; index++) {
      const identifier = new LocaleIdentifier(requested[index]!);
      const matched = this.match(identifier.withoutUnicode(), matcher);
      if (matched !== undefined) return new LocaleSelection(matched, identifier);
    }
    const fallback = new LocaleIdentifier(this.data.defaultLocale()).withoutUnicode();
    return new LocaleSelection(this.match(fallback, matcher) ?? "en");
  }

  numberLocale(
    requested: readonly string[],
    options?: Readonly<Intl.NumberFormatOptions>,
  ): NumberLocale {
    if (options === null) throw new TypeError("Intl options must not be null");
    const matcher = stringOption(options?.localeMatcher, matchers, "best fit");
    const option = optionalString(options?.numberingSystem);
    if (option !== undefined && !validUnicodeType(option))
      throw new RangeError("Invalid numbering system identifier");
    const selection = this.resolve(requested, matcher);
    const extension = selection.requested?.keyword("nu");
    const locale = selection.locale;
    let numberingSystem = this.data.defaultNumberingSystem(locale);
    let addition = "";
    if (extension !== undefined && this.data.hasNumberingSystem(extension)) {
      numberingSystem = extension;
      addition = "-u-nu-" + extension;
    }
    if (
      option !== undefined &&
      this.data.hasNumberingSystem(option) &&
      option !== numberingSystem
    ) {
      numberingSystem = option;
      addition = "";
    }
    return new NumberLocale(
      locale + addition,
      numberingSystem,
      new LocaleIdentifier(locale).withKeyword("nu", numberingSystem),
    );
  }
}
