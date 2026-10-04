import { numberOption, stringOption } from "./options.ts";

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
const increments: readonly Intl.ResolvedNumberFormatOptions["roundingIncrement"][] = [
  1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 2500, 5000,
];

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

// Shared SetNumberFormatDigitOptions slots. Inheritance keeps NumberFormat's
// configuration in one object; PluralRules reads only its specified options.
export class NumberDigits<
  O extends Readonly<
    Pick<
      Intl.NumberFormatOptions,
      | "minimumIntegerDigits"
      | "minimumFractionDigits"
      | "maximumFractionDigits"
      | "minimumSignificantDigits"
      | "maximumSignificantDigits"
      | "roundingIncrement"
      | "roundingMode"
      | "roundingPriority"
      | "trailingZeroDisplay"
    >
  > = Readonly<Intl.NumberFormatOptions>,
> implements Readonly<
  Pick<
    Intl.ResolvedNumberFormatOptions,
    | "minimumIntegerDigits"
    | "minimumFractionDigits"
    | "maximumFractionDigits"
    | "minimumSignificantDigits"
    | "maximumSignificantDigits"
    | "roundingIncrement"
    | "roundingMode"
    | "roundingPriority"
    | "trailingZeroDisplay"
  >
> {
  readonly minimumIntegerDigits: number;
  readonly minimumFractionDigits?: number;
  readonly maximumFractionDigits?: number;
  readonly minimumSignificantDigits?: number;
  readonly maximumSignificantDigits?: number;
  readonly roundingIncrement: Intl.ResolvedNumberFormatOptions["roundingIncrement"];
  readonly roundingMode: Intl.ResolvedNumberFormatOptions["roundingMode"];
  readonly roundingPriority: Intl.ResolvedNumberFormatOptions["roundingPriority"];
  readonly trailingZeroDisplay: Intl.ResolvedNumberFormatOptions["trailingZeroDisplay"];

  constructor(
    options: O | undefined,
    minimumDefault: number,
    maximumDefault: number,
    notation: Intl.ResolvedNumberFormatOptions["notation"],
  ) {
    // Read all digit options before interpreting their interaction. In
    // particular, ignored fraction options must not be numerically converted.
    this.minimumIntegerDigits = numberOption(options?.minimumIntegerDigits, 1, 21, 1);
    const minimumFraction = options?.minimumFractionDigits;
    const maximumFraction = options?.maximumFractionDigits;
    const minimumSignificant = options?.minimumSignificantDigits;
    const maximumSignificant = options?.maximumSignificantDigits;
    this.roundingIncrement = roundingIncrement(options?.roundingIncrement);
    this.roundingMode = stringOption(options?.roundingMode, roundingModes, "halfExpand");
    const priority = stringOption(options?.roundingPriority, priorities, "auto");
    this.trailingZeroDisplay = stringOption(options?.trailingZeroDisplay, trailingZeros, "auto");
    if (this.roundingIncrement !== 1) maximumDefault = minimumDefault;
    const hasSignificant = minimumSignificant !== undefined || maximumSignificant !== undefined;
    const hasFraction = minimumFraction !== undefined || maximumFraction !== undefined;
    const needSignificant = priority !== "auto" || hasSignificant;
    const needFraction =
      priority !== "auto" || (!hasSignificant && (hasFraction || notation !== "compact"));
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
  }

  skeleton(negative = false): string {
    let text = this.precisionSkeleton();
    if (this.trailingZeroDisplay === "stripIfInteger") text += "/w";
    return (
      text +
      " " +
      roundingSkeleton(this.roundingMode, negative) +
      " integer-width/*" +
      "0".repeat(this.minimumIntegerDigits)
    );
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

function roundingSkeleton(
  mode: Intl.ResolvedNumberFormatOptions["roundingMode"],
  negative: boolean,
): string {
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
      return negative ? "rounding-mode-half-down" : "rounding-mode-half-up";
    case "halfFloor":
      return negative ? "rounding-mode-half-up" : "rounding-mode-half-down";
    case "halfExpand":
      return "rounding-mode-half-up";
    case "halfTrunc":
      return "rounding-mode-half-down";
    case "halfEven":
      return "rounding-mode-half-even";
  }
}
