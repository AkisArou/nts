import { optionalString, stringOption } from "./options.ts";
import { validUnit } from "./units.ts";
import { validCurrency } from "./currency.ts";
import { NumberDigits } from "./number-digits.ts";
import { numberNotation, compactDisplay, notationSkeleton } from "./number-notation.ts";

import type { NumberFormatData } from "./number-data.ts";
export type { NumberFormatData } from "./number-data.ts";

const styles: readonly Intl.ResolvedNumberFormatOptions["style"][] = [
  "decimal",
  "percent",
  "currency",
  "unit",
];
const currencyDisplays: readonly NonNullable<
  Intl.ResolvedNumberFormatOptions["currencyDisplay"]
>[] = ["code", "symbol", "narrowSymbol", "name"];
const currencySigns: readonly NonNullable<Intl.ResolvedNumberFormatOptions["currencySign"]>[] = [
  "standard",
  "accounting",
];
const unitDisplays: readonly NonNullable<Intl.ResolvedNumberFormatOptions["unitDisplay"]>[] = [
  "short",
  "narrow",
  "long",
];
const signs: readonly Intl.ResolvedNumberFormatOptions["signDisplay"][] = [
  "auto",
  "never",
  "always",
  "exceptZero",
  "negative",
];
function grouping(
  value: Intl.NumberFormatOptions["useGrouping"],
  compact: boolean,
): Intl.ResolvedNumberFormatOptions["useGrouping"] {
  const fallback = compact ? "min2" : "auto";
  if (value === undefined) return fallback;
  if (!value) return false;
  if (value === true) return "always";
  const text = optionalString(value)!;
  if (text === "true" || text === "false") return fallback;
  if (text === "min2" || text === "auto" || text === "always") return text;
  throw new RangeError("Invalid Intl grouping option");
}

// Locale-independent NumberFormat slots. Construct once, before opening ICU.
// Library types are used directly; this is internal configuration, not an
// incomplete implementation of the public Intl.NumberFormat interface.
export class NumberFormatConfiguration<D extends NumberFormatData>
  extends NumberDigits
  implements Readonly<Omit<Intl.ResolvedNumberFormatOptions, "locale" | "numberingSystem">>
{
  readonly style: Intl.ResolvedNumberFormatOptions["style"];
  readonly currency?: string;
  readonly currencyDisplay?: Intl.ResolvedNumberFormatOptions["currencyDisplay"];
  readonly currencySign?: Intl.ResolvedNumberFormatOptions["currencySign"];
  readonly unit?: string;
  readonly unitDisplay?: Intl.ResolvedNumberFormatOptions["unitDisplay"];
  readonly notation: Intl.ResolvedNumberFormatOptions["notation"];
  readonly compactDisplay?: Intl.ResolvedNumberFormatOptions["compactDisplay"];
  readonly useGrouping: Intl.ResolvedNumberFormatOptions["useGrouping"];
  readonly signDisplay: Intl.ResolvedNumberFormatOptions["signDisplay"];

  constructor(data: D, options?: Readonly<Intl.NumberFormatOptions>) {
    if (options === null) throw new TypeError("Intl options must not be null");
    const style = stringOption(options?.style, styles, "decimal");
    const currency = optionalString(options?.currency);
    if (currency === undefined) {
      if (style === "currency") throw new TypeError("Currency is required");
    } else if (!validCurrency(currency)) throw new RangeError("Invalid currency code");
    const currencyDisplay = stringOption(options?.currencyDisplay, currencyDisplays, "symbol");
    const currencySign = stringOption(options?.currencySign, currencySigns, "standard");
    const unit = optionalString(options?.unit);
    if (unit === undefined) {
      if (style === "unit") throw new TypeError("Unit is required");
    } else if (!validUnit(unit)) throw new RangeError("Invalid measurement unit");
    const unitDisplay = stringOption(options?.unitDisplay, unitDisplays, "short");
    const notation = numberNotation(options?.notation);
    const currencyPrecision = style === "currency" && notation === "standard";
    const minimumDefault = currencyPrecision ? data.currencyDigits(currency!.toUpperCase()) : 0;
    const maximumDefault = currencyPrecision ? minimumDefault : style === "percent" ? 0 : 3;
    super(options, minimumDefault, maximumDefault, notation);
    this.style = style;
    this.notation = notation;
    if (style === "currency") {
      this.currency = currency!.toUpperCase();
      this.currencyDisplay = currencyDisplay;
      this.currencySign = currencySign;
    }
    if (style === "unit") {
      this.unit = unit;
      this.unitDisplay = unitDisplay;
    }
    const compact = compactDisplay(options?.compactDisplay);
    if (notation === "compact") this.compactDisplay = compact;
    this.useGrouping = grouping(options?.useGrouping, notation === "compact");
    this.signDisplay = stringOption(options?.signDisplay, signs, "auto");
  }

  // Construction-only translation to ICU's declarative primitive. The explicit
  // precision and rounding tokens override ICU's different default rounding.
  override skeleton(negative = false): string {
    let text = "";
    if (this.style === "percent") text = "percent scale/100 ";
    else if (this.style === "currency") text = "currency/" + this.currency + " ";
    else if (this.style === "unit") text = "unit/" + this.unit + " ";
    if (this.style === "currency") {
      if (this.currencyDisplay === "code") text += "unit-width-iso-code ";
      else if (this.currencyDisplay === "name") text += "unit-width-full-name ";
      else if (this.currencyDisplay === "narrowSymbol") text += "unit-width-narrow ";
      else text += "unit-width-short ";
    } else if (this.style === "unit") {
      if (this.unitDisplay === "long") text += "unit-width-full-name ";
      else if (this.unitDisplay === "narrow") text += "unit-width-narrow ";
      else text += "unit-width-short ";
    }
    text += notationSkeleton(this.notation, this.compactDisplay) + super.skeleton(negative);
    if (this.useGrouping === false) text += " group-off";
    else if (this.useGrouping === "always") text += " group-on-aligned";
    else text += " group-" + this.useGrouping;
    return text + " " + signSkeleton(this.signDisplay, this.currencySign === "accounting");
  }
}

function signSkeleton(
  sign: Intl.ResolvedNumberFormatOptions["signDisplay"],
  accounting: boolean,
): string {
  switch (sign) {
    case "auto":
      return accounting ? "sign-accounting" : "sign-auto";
    case "always":
      return accounting ? "sign-accounting-always" : "sign-always";
    case "exceptZero":
      return accounting ? "sign-accounting-except-zero" : "sign-except-zero";
    case "negative":
      return accounting ? "sign-accounting-negative" : "sign-negative";
    case "never":
      return "sign-never";
  }
}
