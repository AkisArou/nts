import { LocaleResolver } from "./locale.ts";
import type { LocaleData, NumberLocale } from "./locale.ts";
import { getCanonicalLocales } from "./locale-list.ts";
import { NumberFormatConfiguration } from "./number-options.ts";
import type { NumberFormatData } from "./number-options.ts";
import { NumberFormatter } from "./number.ts";
import type { NumberFormatterPrimitive } from "./number.ts";
import { mathematicalValue, rangeValue } from "./mathematical-value.ts";
export { LocaleResolver } from "./locale.ts";
export { getCanonicalLocales, supportedLocalesOf } from "./locale-list.ts";
export { NtsLocale } from "./locale-object.ts";
export { NtsCollator } from "./collator.ts";
export { NtsDateTimeFormat } from "./date-time-builtins.ts";
export { TimeZoneRegistry } from "../time/zone-id.ts";

// The compiler's standard builtin binding supplies the environment resolver
// and concrete provider factory. Public inputs/results use library types.
export class NtsNumberFormat<
  D extends LocaleData & NumberFormatData,
  P extends NumberFormatterPrimitive,
>
  implements Intl.NumberFormat
{
  readonly #configuration: NumberFormatConfiguration<D>;
  readonly #locale: NumberLocale;
  readonly #formatter: NumberFormatter<P>;
  #bound: Intl.NumberFormat["format"] | undefined;

  constructor(
    resolver: LocaleResolver<D>,
    open: (locale: string, skeleton: string, negativeSkeleton: string) => P,
    locales: Intl.LocalesArgument = undefined,
    options?: Readonly<Intl.NumberFormatOptions>,
  ) {
    const requested = getCanonicalLocales(resolver.data, locales);
    this.#locale = resolver.numberLocale(requested, options);
    this.#configuration = new NumberFormatConfiguration(resolver.data, options);
    const signRounding =
      this.#configuration.roundingMode === "halfCeil" ||
      this.#configuration.roundingMode === "halfFloor";
    this.#formatter = new NumberFormatter(
      open(
        this.#locale.dataLocale,
        this.#configuration.skeleton(),
        signRounding ? this.#configuration.skeleton(true) : "",
      ),
      this.#configuration.style === "unit" && this.#configuration.unit === "percent",
      signRounding,
    );
  }

  get format(): Intl.NumberFormat["format"] {
    if (this.#bound === undefined)
      this.#bound = (value?: number | bigint | Intl.StringNumericLiteral): string =>
        this.#formatValue(value);
    return this.#bound;
  }

  #formatValue(input: number | bigint | Intl.StringNumericLiteral | undefined): string {
    const value = mathematicalValue(input);
    return typeof value === "string"
      ? this.#formatter.formatDecimal(value)
      : this.#formatter.format(value);
  }

  formatToParts(input?: number | bigint | Intl.StringNumericLiteral): Intl.NumberFormatPart[] {
    const value = mathematicalValue(input);
    return typeof value === "string"
      ? this.#formatter.formatDecimalToParts(value)
      : this.#formatter.formatToParts(value);
  }

  formatRange(
    start: number | bigint | Intl.StringNumericLiteral,
    end: number | bigint | Intl.StringNumericLiteral,
  ): string {
    if (start === undefined || end === undefined)
      throw new TypeError("NumberFormat ranges require both endpoints");
    const first = mathematicalValue(start);
    const last = mathematicalValue(end);
    if (
      (typeof first === "number" && Number.isNaN(first)) ||
      (typeof last === "number" && Number.isNaN(last))
    )
      throw new RangeError("NumberFormat range endpoints must not be NaN");
    return this.#formatter.formatRange(rangeValue(first), rangeValue(last));
  }

  formatRangeToParts(
    start: number | bigint | Intl.StringNumericLiteral,
    end: number | bigint | Intl.StringNumericLiteral,
  ): Intl.NumberRangeFormatPart[] {
    if (start === undefined || end === undefined)
      throw new TypeError("NumberFormat ranges require both endpoints");
    const first = mathematicalValue(start);
    const last = mathematicalValue(end);
    if (
      (typeof first === "number" && Number.isNaN(first)) ||
      (typeof last === "number" && Number.isNaN(last))
    )
      throw new RangeError("NumberFormat range endpoints must not be NaN");
    return this.#formatter.formatRangeToParts(rangeValue(first), rangeValue(last));
  }

  resolvedOptions(): Intl.ResolvedNumberFormatOptions {
    const config = this.#configuration;
    const result: Intl.ResolvedNumberFormatOptions = {
      locale: this.#locale.locale,
      numberingSystem: this.#locale.numberingSystem,
      style: config.style,
      ...(config.style === "currency"
        ? {
            currency: config.currency,
            currencyDisplay: config.currencyDisplay,
            currencySign: config.currencySign,
          }
        : {}),
      ...(config.style === "unit" ? { unit: config.unit, unitDisplay: config.unitDisplay } : {}),
      minimumIntegerDigits: config.minimumIntegerDigits,
      ...(config.minimumFractionDigits === undefined
        ? {}
        : {
            minimumFractionDigits: config.minimumFractionDigits,
            maximumFractionDigits: config.maximumFractionDigits,
          }),
      ...(config.minimumSignificantDigits === undefined
        ? {}
        : {
            minimumSignificantDigits: config.minimumSignificantDigits,
            maximumSignificantDigits: config.maximumSignificantDigits,
          }),
      useGrouping: config.useGrouping,
      notation: config.notation,
      ...(config.notation === "compact" ? { compactDisplay: config.compactDisplay } : {}),
      signDisplay: config.signDisplay,
      roundingIncrement: config.roundingIncrement,
      roundingMode: config.roundingMode,
      roundingPriority: config.roundingPriority,
      trailingZeroDisplay: config.trailingZeroDisplay,
    };
    return result;
  }
}
