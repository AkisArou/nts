import { LocaleResolver } from "./locale.ts";
import type { LocaleData } from "./locale-data.ts";
import { getCanonicalLocales } from "./locale-list.ts";
import { stringOption } from "./options.ts";
import { NumberDigits } from "./number-digits.ts";
import { numberNotation, compactDisplay, notationSkeleton } from "./number-notation.ts";
import { mathematicalValue, rangeValue } from "./mathematical-value.ts";
import type { PluralRulesPrimitive } from "./plural-data.ts";
import { pluralCategories, pluralCategory } from "./plural-category.ts";

const matchers: readonly NonNullable<Intl.PluralRulesOptions["localeMatcher"]>[] = [
  "lookup",
  "best fit",
];
const types: readonly Intl.PluralRuleType[] = ["cardinal", "ordinal"];

// The pinned library omits notation, rounding and exact mathematical inputs;
// its resolved result also requires fraction digits when significant precision
// correctly omits them. Derive those corrections from NumberFormat's fields.
export class NtsPluralRules<D extends LocaleData, P extends PluralRulesPrimitive> {
  readonly #locale: string;
  readonly #type: Intl.PluralRuleType;
  readonly #notation: Intl.ResolvedNumberFormatOptions["notation"];
  readonly #compactDisplay: Intl.ResolvedNumberFormatOptions["compactDisplay"];
  readonly #digits: NumberDigits;
  readonly #primitive: P;
  readonly #categories: Intl.LDMLPluralRule[];
  readonly #signRounding: boolean;

  constructor(
    resolver: LocaleResolver<D>,
    open: (locale: string, ordinal: boolean, skeleton: string, negativeSkeleton: string) => P,
    locales: Intl.LocalesArgument = undefined,
    options:
      | Readonly<
          Intl.PluralRulesOptions &
            Pick<
              Intl.NumberFormatOptions,
              | "notation"
              | "compactDisplay"
              | "roundingIncrement"
              | "roundingMode"
              | "roundingPriority"
              | "trailingZeroDisplay"
            >
        >
      | undefined = undefined,
  ) {
    const requested = getCanonicalLocales(resolver.data, locales);
    if (options === null) throw new TypeError("Intl options must not be null");
    const matcher = stringOption(options?.localeMatcher, matchers, "best fit");
    this.#locale = resolver.resolve(requested, matcher).locale;
    this.#type = stringOption(options?.type, types, "cardinal");
    this.#notation = numberNotation(options?.notation);
    const compact = compactDisplay(options?.compactDisplay);
    this.#compactDisplay = this.#notation === "compact" ? compact : undefined;
    this.#digits = new NumberDigits(options, 0, 3, this.#notation);
    this.#signRounding =
      this.#digits.roundingMode === "halfCeil" || this.#digits.roundingMode === "halfFloor";
    const prefix = notationSkeleton(this.#notation, this.#compactDisplay);
    this.#primitive = open(
      this.#locale,
      this.#type === "ordinal",
      prefix + this.#digits.skeleton() + " group-off",
      this.#signRounding ? prefix + this.#digits.skeleton(true) + " group-off" : "",
    );
    this.#categories = pluralCategories(this.#primitive.categories());
  }

  select(value: number | bigint | Intl.StringNumericLiteral): Intl.LDMLPluralRule {
    const primitive = this.#primitive;
    const number = mathematicalValue(value);
    if (typeof number === "number" && !Number.isFinite(number)) return "other";
    return pluralCategory(
      typeof number === "string"
        ? primitive.selectDecimal(number, this.#signRounding && number.charAt(0) === "-")
        : primitive.select(number, this.#signRounding && (number < 0 || Object.is(number, -0))),
    );
  }

  selectRange(
    start: number | bigint | Intl.StringNumericLiteral,
    end: number | bigint | Intl.StringNumericLiteral,
  ): Intl.LDMLPluralRule {
    const primitive = this.#primitive;
    if (start === undefined || end === undefined)
      throw new TypeError("PluralRules ranges require both endpoints");
    const first = mathematicalValue(start);
    const last = mathematicalValue(end);
    if (
      (typeof first === "number" && Number.isNaN(first)) ||
      (typeof last === "number" && Number.isNaN(last))
    )
      throw new RangeError("PluralRules range endpoints must not be NaN");
    const firstText = rangeValue(first);
    const lastText = rangeValue(last);
    return pluralCategory(
      primitive.selectRange(
        firstText,
        lastText,
        this.#signRounding && firstText.charAt(0) === "-",
        this.#signRounding && lastText.charAt(0) === "-",
      ),
    );
  }

  resolvedOptions(): Omit<
    Intl.ResolvedPluralRulesOptions,
    "minimumFractionDigits" | "maximumFractionDigits"
  > &
    Partial<
      Pick<Intl.ResolvedPluralRulesOptions, "minimumFractionDigits" | "maximumFractionDigits">
    > &
    Pick<
      Intl.ResolvedNumberFormatOptions,
      | "notation"
      | "compactDisplay"
      | "roundingIncrement"
      | "roundingMode"
      | "roundingPriority"
      | "trailingZeroDisplay"
    > {
    const digits = this.#digits;
    return {
      locale: this.#locale,
      type: this.#type,
      notation: this.#notation,
      ...(this.#notation === "compact" ? { compactDisplay: this.#compactDisplay } : {}),
      minimumIntegerDigits: digits.minimumIntegerDigits,
      ...(digits.minimumFractionDigits === undefined
        ? {}
        : {
            minimumFractionDigits: digits.minimumFractionDigits,
            maximumFractionDigits: digits.maximumFractionDigits,
          }),
      ...(digits.minimumSignificantDigits === undefined
        ? {}
        : {
            minimumSignificantDigits: digits.minimumSignificantDigits,
            maximumSignificantDigits: digits.maximumSignificantDigits,
          }),
      pluralCategories: this.#categories.slice(),
      roundingIncrement: digits.roundingIncrement,
      roundingMode: digits.roundingMode,
      roundingPriority: digits.roundingPriority,
      trailingZeroDisplay: digits.trailingZeroDisplay,
    };
  }
}
