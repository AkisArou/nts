import { numberOption, optionalString, stringOption } from "./options.ts";

// Data supplied by the pinned provider, rather than a second currency table.
export interface NumberFormatData {
  currencyDigits(currency: string): number;
}

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
const notations: readonly Intl.ResolvedNumberFormatOptions["notation"][] = [
  "standard",
  "scientific",
  "engineering",
  "compact",
];
const compactDisplays: readonly NonNullable<Intl.ResolvedNumberFormatOptions["compactDisplay"]>[] =
  ["short", "long"];
const priorities: readonly Intl.ResolvedNumberFormatOptions["roundingPriority"][] = [
  "auto",
  "morePrecision",
  "lessPrecision",
];
const roundingModes: readonly Intl.ResolvedNumberFormatOptions["roundingMode"][] = [
  "ceil",
  "floor",
  "expand",
  "trunc",
  "halfCeil",
  "halfFloor",
  "halfExpand",
  "halfTrunc",
  "halfEven",
];
const trailingZeros: readonly Intl.ResolvedNumberFormatOptions["trailingZeroDisplay"][] = [
  "auto",
  "stripIfInteger",
];
const signs: readonly Intl.ResolvedNumberFormatOptions["signDisplay"][] = [
  "auto",
  "never",
  "always",
  "exceptZero",
  "negative",
];
const increments: readonly Intl.ResolvedNumberFormatOptions["roundingIncrement"][] = [
  1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 2500, 5000,
];

// The spec's sanctioned unit set is narrower than ICU's unit registry.
// Keep validation here; ICU must not accidentally admit extra JS units.
const units: readonly string[] = [
  "acre",
  "bit",
  "byte",
  "celsius",
  "centimeter",
  "day",
  "degree",
  "fahrenheit",
  "fluid-ounce",
  "foot",
  "gallon",
  "gigabit",
  "gigabyte",
  "gram",
  "hectare",
  "hour",
  "inch",
  "kilobit",
  "kilobyte",
  "kilogram",
  "kilometer",
  "liter",
  "megabit",
  "megabyte",
  "meter",
  "microsecond",
  "mile",
  "mile-scandinavian",
  "milliliter",
  "millimeter",
  "millisecond",
  "minute",
  "month",
  "nanosecond",
  "ounce",
  "percent",
  "petabyte",
  "pound",
  "second",
  "stone",
  "terabit",
  "terabyte",
  "week",
  "yard",
  "year",
];

function validCurrency(currency: string): boolean {
  if (currency.length !== 3) return false;
  for (let i = 0; i < 3; i++) {
    const c = currency.charCodeAt(i);
    if (!((c >= 65 && c <= 90) || (c >= 97 && c <= 122))) return false;
  }
  return true;
}

function validUnit(unit: string): boolean {
  if (units.includes(unit)) return true;
  const per = unit.indexOf("-per-");
  return per >= 0 && units.includes(unit.slice(0, per)) && units.includes(unit.slice(per + 5));
}

function roundingIncrement(
  value: Intl.NumberFormatOptions["roundingIncrement"],
): Intl.ResolvedNumberFormatOptions["roundingIncrement"] {
  const number = numberOption(value, 1, 5000, 1);
  for (let i = 0; i < increments.length; i++) {
    const candidate = increments[i]!;
    if (number === candidate) return candidate;
  }
  throw new RangeError("Invalid Intl rounding increment");
}

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
export class NumberFormatConfiguration<D extends NumberFormatData> implements Readonly<
  Omit<Intl.ResolvedNumberFormatOptions, "locale" | "numberingSystem">
> {
  readonly style: Intl.ResolvedNumberFormatOptions["style"];
  readonly currency?: string;
  readonly currencyDisplay?: Intl.ResolvedNumberFormatOptions["currencyDisplay"];
  readonly currencySign?: Intl.ResolvedNumberFormatOptions["currencySign"];
  readonly unit?: string;
  readonly unitDisplay?: Intl.ResolvedNumberFormatOptions["unitDisplay"];
  readonly minimumIntegerDigits: number;
  readonly minimumFractionDigits?: number;
  readonly maximumFractionDigits?: number;
  readonly minimumSignificantDigits?: number;
  readonly maximumSignificantDigits?: number;
  readonly notation: Intl.ResolvedNumberFormatOptions["notation"];
  readonly compactDisplay?: Intl.ResolvedNumberFormatOptions["compactDisplay"];
  readonly useGrouping: Intl.ResolvedNumberFormatOptions["useGrouping"];
  readonly signDisplay: Intl.ResolvedNumberFormatOptions["signDisplay"];
  readonly roundingIncrement: Intl.ResolvedNumberFormatOptions["roundingIncrement"];
  readonly roundingMode: Intl.ResolvedNumberFormatOptions["roundingMode"];
  readonly roundingPriority: Intl.ResolvedNumberFormatOptions["roundingPriority"];
  readonly trailingZeroDisplay: Intl.ResolvedNumberFormatOptions["trailingZeroDisplay"];

  constructor(data: D, options: Readonly<Intl.NumberFormatOptions> = {}) {
    if (options === null) throw new TypeError("Intl options must not be null");
    this.style = stringOption(options.style, styles, "decimal");
    const currency = optionalString(options.currency);
    if (currency === undefined) {
      if (this.style === "currency") throw new TypeError("Currency is required");
    } else if (!validCurrency(currency)) throw new RangeError("Invalid currency code");
    const currencyDisplay = stringOption(options.currencyDisplay, currencyDisplays, "symbol");
    const currencySign = stringOption(options.currencySign, currencySigns, "standard");
    const unit = optionalString(options.unit);
    if (unit === undefined) {
      if (this.style === "unit") throw new TypeError("Unit is required");
    } else if (!validUnit(unit)) throw new RangeError("Invalid measurement unit");
    const unitDisplay = stringOption(options.unitDisplay, unitDisplays, "short");
    if (this.style === "currency") {
      this.currency = currency!.toUpperCase();
      this.currencyDisplay = currencyDisplay;
      this.currencySign = currencySign;
    }
    if (this.style === "unit") {
      this.unit = unit;
      this.unitDisplay = unitDisplay;
    }
    this.notation = stringOption(options.notation, notations, "standard");
    const currencyPrecision = this.style === "currency" && this.notation === "standard";
    const minimumDefault = currencyPrecision ? data.currencyDigits(this.currency!) : 0;
    let maximumDefault = currencyPrecision ? minimumDefault : this.style === "percent" ? 0 : 3;

    // Read all digit options before interpreting their interaction. In
    // particular, ignored fraction options must not be numerically converted.
    this.minimumIntegerDigits = numberOption(options.minimumIntegerDigits, 1, 21, 1);
    const minimumFraction = options.minimumFractionDigits;
    const maximumFraction = options.maximumFractionDigits;
    const minimumSignificant = options.minimumSignificantDigits;
    const maximumSignificant = options.maximumSignificantDigits;
    this.roundingIncrement = roundingIncrement(options.roundingIncrement);
    this.roundingMode = stringOption(options.roundingMode, roundingModes, "halfExpand");
    const priority = stringOption(options.roundingPriority, priorities, "auto");
    this.trailingZeroDisplay = stringOption(options.trailingZeroDisplay, trailingZeros, "auto");
    if (this.roundingIncrement !== 1) maximumDefault = minimumDefault;
    const hasSignificant = minimumSignificant !== undefined || maximumSignificant !== undefined;
    const hasFraction = minimumFraction !== undefined || maximumFraction !== undefined;
    const needSignificant = priority !== "auto" || hasSignificant;
    const needFraction =
      priority !== "auto" || (!hasSignificant && (hasFraction || this.notation !== "compact"));
    if (needSignificant) {
      this.minimumSignificantDigits = numberOption(minimumSignificant, 1, 21, 1);
      this.maximumSignificantDigits = numberOption(
        maximumSignificant,
        this.minimumSignificantDigits,
        21,
        21,
      );
    }
    if (needFraction) {
      const minimum =
        minimumFraction === undefined ? undefined : numberOption(minimumFraction, 0, 100, 0);
      const maximum =
        maximumFraction === undefined ? undefined : numberOption(maximumFraction, 0, 100, 0);
      this.minimumFractionDigits =
        minimum ?? (maximum === undefined ? minimumDefault : Math.min(minimumDefault, maximum));
      this.maximumFractionDigits = maximum ?? Math.max(maximumDefault, this.minimumFractionDigits);
      if (this.minimumFractionDigits > this.maximumFractionDigits)
        throw new RangeError("Minimum fraction digits exceed maximum");
    }
    if (!needSignificant && !needFraction) {
      this.minimumFractionDigits = 0;
      this.maximumFractionDigits = 0;
      this.minimumSignificantDigits = 1;
      this.maximumSignificantDigits = 2;
      this.roundingPriority = "morePrecision";
    } else this.roundingPriority = priority;
    if (this.roundingIncrement !== 1) {
      if (this.roundingPriority !== "auto" || needSignificant)
        throw new TypeError("Rounding increments require fraction precision");
      if (this.minimumFractionDigits !== this.maximumFractionDigits)
        throw new RangeError("Rounding increments require equal fraction digits");
    }
    const compactDisplay = stringOption(options.compactDisplay, compactDisplays, "short");
    if (this.notation === "compact") this.compactDisplay = compactDisplay;
    this.useGrouping = grouping(options.useGrouping, this.notation === "compact");
    this.signDisplay = stringOption(options.signDisplay, signs, "auto");
  }

  // Construction-only translation to ICU's declarative primitive. The explicit
  // precision and rounding tokens override ICU's different default rounding.
  skeleton(): string {
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
    if (this.notation === "compact") text += "compact-" + this.compactDisplay + " ";
    else if (this.notation !== "standard") text += this.notation + " ";
    text += this.precisionSkeleton();
    if (this.trailingZeroDisplay === "stripIfInteger") text += "/w";
    text += " " + roundingSkeleton(this.roundingMode);
    text += " integer-width/*" + "0".repeat(this.minimumIntegerDigits);
    if (this.useGrouping === false) text += " group-off";
    else if (this.useGrouping === "always") text += " group-on-aligned";
    else text += " group-" + this.useGrouping;
    return text + " " + signSkeleton(this.signDisplay, this.currencySign === "accounting");
  }

  private precisionSkeleton(): string {
    if (this.roundingIncrement !== 1) {
      const digits = String(this.roundingIncrement);
      const fraction = this.maximumFractionDigits!;
      if (fraction === 0) return "precision-increment/" + digits;
      const padded = "0".repeat(Math.max(0, fraction + 1 - digits.length)) + digits;
      const point = padded.length - fraction;
      return "precision-increment/" + padded.slice(0, point) + "." + padded.slice(point);
    }
    let significant = "";
    if (this.minimumSignificantDigits !== undefined)
      significant =
        "@".repeat(this.minimumSignificantDigits) +
        "#".repeat(this.maximumSignificantDigits! - this.minimumSignificantDigits);
    if (this.minimumFractionDigits === undefined) return significant;
    const fraction =
      "." +
      "0".repeat(this.minimumFractionDigits) +
      "#".repeat(this.maximumFractionDigits! - this.minimumFractionDigits);
    if (this.roundingPriority === "auto") return fraction;
    return fraction + "/" + significant + (this.roundingPriority === "morePrecision" ? "r" : "s");
  }
}

function roundingSkeleton(mode: Intl.ResolvedNumberFormatOptions["roundingMode"]): string {
  switch (mode) {
    case "ceil":
      return "rounding-mode-ceiling";
    case "floor":
      return "rounding-mode-floor";
    case "expand":
      return "rounding-mode-up";
    case "trunc":
      return "rounding-mode-down";
    case "halfCeil":
      return "rounding-mode-half-ceiling";
    case "halfFloor":
      return "rounding-mode-half-floor";
    case "halfExpand":
      return "rounding-mode-half-up";
    case "halfTrunc":
      return "rounding-mode-half-down";
    case "halfEven":
      return "rounding-mode-half-even";
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
