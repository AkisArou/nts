import { LocaleResolver } from "./locale.ts";
import { LocaleIdentifier, validUnicodeType } from "./locale-id.ts";
import { getCanonicalLocales } from "./locale-list.ts";
import { optionalString, stringOption } from "./options.ts";
import type { CollationData } from "./locale-data.ts";
import type { CollatorPrimitive } from "./collation.ts";

const usages: readonly NonNullable<Intl.CollatorOptions["usage"]>[] = ["sort", "search"];
const matchers: readonly NonNullable<Intl.CollatorOptions["localeMatcher"]>[] = [
  "lookup",
  "best fit",
];
const sensitivities: readonly NonNullable<Intl.CollatorOptions["sensitivity"]>[] = [
  "base",
  "accent",
  "case",
  "variant",
];
const caseFirstValues: readonly NonNullable<Intl.CollatorOptions["caseFirst"]>[] = [
  "false",
  "upper",
  "lower",
];

// Configuration is immutable and built once. No options, locale identifiers or
// result records are constructed by the comparison callback.
export class CollatorConfiguration<D extends CollationData> {
  readonly locale: string;
  readonly dataLocale: string;
  readonly usage: NonNullable<Intl.CollatorOptions["usage"]>;
  readonly sensitivity: NonNullable<Intl.CollatorOptions["sensitivity"]>;
  readonly ignorePunctuation: boolean;
  readonly collation: string;
  readonly numeric: boolean;
  readonly caseFirst: NonNullable<Intl.CollatorOptions["caseFirst"]>;

  constructor(
    resolver: LocaleResolver<D>,
    requested: readonly string[],
    options?: Readonly<Intl.CollatorOptions>,
  ) {
    if (options === null) throw new TypeError("Intl options must not be null");
    this.usage = stringOption(options?.usage, usages, "sort");
    const matcher = stringOption(options?.localeMatcher, matchers, "best fit");
    const collationOption = optionalString(options?.collation);
    if (collationOption !== undefined && !validUnicodeType(collationOption))
      throw new RangeError("Invalid collation identifier");
    const rawNumeric = options?.numeric;
    const numericOption = rawNumeric === undefined ? undefined : Boolean(rawNumeric);
    const rawCaseFirst = options?.caseFirst;
    const caseFirstOption =
      rawCaseFirst === undefined ? undefined : stringOption(rawCaseFirst, caseFirstValues, "false");
    const selection = resolver.resolve(requested, matcher);
    const identifier = selection.requested;
    const collations =
      this.usage === "search" ? [] : resolver.data.collationValues(selection.locale);
    const extensionCollation = identifier?.keyword("co");
    let collation = "default";
    let collationAddition: string | undefined;
    if (
      extensionCollation !== undefined &&
      extensionCollation !== "standard" &&
      extensionCollation !== "search" &&
      collations.includes(extensionCollation)
    ) {
      collation = extensionCollation;
      collationAddition = extensionCollation;
    }
    if (
      collationOption !== undefined &&
      collationOption !== "standard" &&
      collationOption !== "search" &&
      collations.includes(collationOption) &&
      collationOption !== collation
    ) {
      collation = collationOption;
      collationAddition = undefined;
    }
    const dataLocale = new LocaleIdentifier(selection.locale).withKeywords(
      ["co"],
      [this.usage === "search" ? "search" : collation === "default" ? undefined : collation],
    );
    const defaults = resolver.data.collationDefaults(dataLocale);
    let numeric = false;
    let numericAddition: string | undefined;
    const extensionNumeric = identifier?.keyword("kn");
    if (extensionNumeric === "" || extensionNumeric === "true" || extensionNumeric === "false") {
      numeric = extensionNumeric !== "false";
      numericAddition = numeric ? "true" : "false";
    }
    if (numericOption !== undefined && numericOption !== numeric) {
      numeric = numericOption;
      numericAddition = undefined;
    }
    let caseFirst = caseFirstValues[(defaults >> 3) & 3]!;
    let caseFirstAddition: string | undefined;
    const extensionCaseFirst = identifier?.keyword("kf");
    if (
      extensionCaseFirst === "false" ||
      extensionCaseFirst === "upper" ||
      extensionCaseFirst === "lower"
    ) {
      caseFirst = extensionCaseFirst;
      caseFirstAddition = caseFirst;
    }
    if (caseFirstOption !== undefined && caseFirstOption !== caseFirst) {
      caseFirst = caseFirstOption;
      caseFirstAddition = undefined;
    }
    this.sensitivity = stringOption(
      options?.sensitivity,
      sensitivities,
      this.usage === "sort" ? "variant" : sensitivities[defaults & 3]!,
    );
    const rawPunctuation = options?.ignorePunctuation;
    this.ignorePunctuation =
      rawPunctuation === undefined ? (defaults & 4) !== 0 : Boolean(rawPunctuation);
    this.locale = new LocaleIdentifier(selection.locale).withKeywords(
      ["co", "kf", "kn"],
      [collationAddition, caseFirstAddition, numericAddition],
    );
    this.dataLocale = dataLocale;
    this.collation = collation;
    this.numeric = numeric;
    this.caseFirst = caseFirst;
  }

  sensitivityCode(): number {
    return sensitivities.indexOf(this.sensitivity);
  }
  caseFirstCode(): number {
    return caseFirstValues.indexOf(this.caseFirst);
  }
}

export class NtsCollator<D extends CollationData, P extends CollatorPrimitive> {
  readonly #configuration: CollatorConfiguration<D>;
  readonly #primitive: P;
  #bound: Intl.Collator["compare"] | undefined;

  constructor(
    resolver: LocaleResolver<D>,
    open: (
      locale: string,
      sensitivity: number,
      punctuation: boolean,
      numeric: boolean,
      caseFirst: number,
    ) => P,
    locales: Intl.LocalesArgument = undefined,
    options?: Readonly<Intl.CollatorOptions>,
  ) {
    const requested = getCanonicalLocales(resolver.data, locales);
    const config = new CollatorConfiguration(resolver, requested, options);
    this.#primitive = open(
      config.dataLocale,
      config.sensitivityCode(),
      config.ignorePunctuation,
      config.numeric,
      config.caseFirstCode(),
    );
    this.#configuration = config;
  }
  get compare(): Intl.Collator["compare"] {
    if (this.#bound === undefined)
      this.#bound = (one: string, two: string): number => {
        if (typeof one === "symbol") throw new TypeError("Collator string inputs reject Symbols");
        const first = String(one);
        if (typeof two === "symbol") throw new TypeError("Collator string inputs reject Symbols");
        return this.#primitive.compare(first, String(two));
      };
    return this.#bound;
  }
  resolvedOptions(): Intl.ResolvedCollatorOptions {
    const config = this.#configuration;
    return {
      locale: config.locale,
      usage: config.usage,
      sensitivity: config.sensitivity,
      ignorePunctuation: config.ignorePunctuation,
      collation: config.collation,
      numeric: config.numeric,
      caseFirst: config.caseFirst,
    };
  }
}
