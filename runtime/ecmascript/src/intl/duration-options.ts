import { numberOption, stringOption } from "./options.ts";

const styles: readonly Intl.DurationFormatStyle[] = ["long", "short", "narrow", "digital"];
const unitStyles: readonly NonNullable<Intl.DurationFormatOptions["hours"]>[] = [
  "long",
  "short",
  "narrow",
  "numeric",
  "2-digit",
];
const textStyles: readonly NonNullable<Intl.DurationFormatOptions["years"]>[] = [
  "long",
  "short",
  "narrow",
];
const fractionStyles: readonly NonNullable<Intl.DurationFormatOptions["milliseconds"]>[] = [
  "long",
  "short",
  "narrow",
  "numeric",
];
const displays: readonly Intl.DurationFormatDisplayOption[] = ["auto", "always"];
const digits: readonly NonNullable<Intl.DurationFormatOptions["fractionalDigits"]>[] = [
  0, 1, 2, 3, 4, 5, 6, 7, 8, 9,
];

// Codes index unitStyles; 5 is the internal fractional style. Compact buffers
// hold ten immutable style/display slots rather than ten separate records.
export class DurationConfiguration {
  readonly style: Intl.DurationFormatStyle;
  readonly fractionalDigits: Intl.DurationFormatOptions["fractionalDigits"];
  readonly firstNumeric: number;
  readonly firstFractional: number;
  readonly #styles = new Uint8Array(10);
  readonly #displays = new Uint8Array(10);

  constructor(options: Readonly<Intl.DurationFormatOptions> | undefined, twoDigitHours: boolean) {
    this.style = stringOption(options?.style, styles, "short");
    let previous = -1;
    let firstNumeric = -1;
    let firstFractional = 10;
    for (let index = 0; index < 10; index++) {
      const raw =
        index === 0
          ? options?.years
          : index === 1
            ? options?.months
            : index === 2
              ? options?.weeks
              : index === 3
                ? options?.days
                : index === 4
                  ? options?.hours
                  : index === 5
                    ? options?.minutes
                    : index === 6
                      ? options?.seconds
                      : index === 7
                        ? options?.milliseconds
                        : index === 8
                          ? options?.microseconds
                          : options?.nanoseconds;
      let code: number;
      let displayDefault: Intl.DurationFormatDisplayOption = "always";
      if (raw === undefined) {
        if (this.style === "digital") {
          code = index < 4 ? 1 : 3;
          if (index < 4 || index > 6) displayDefault = "auto";
        } else if (previous >= 3) {
          code = 3;
          if (index !== 5 && index !== 6) displayDefault = "auto";
        } else {
          code = styles.indexOf(this.style);
          displayDefault = "auto";
        }
      } else {
        code = unitStyles.indexOf(stringOption(raw, unitStyles, "short"));
        if ((index < 4 && code >= 3) || (index >= 7 && code === 4))
          throw new RangeError("Invalid duration unit style");
      }
      if (index >= 7 && code === 3) {
        code = 5;
        displayDefault = "auto";
      }
      const rawDisplay =
        index === 0
          ? options?.yearsDisplay
          : index === 1
            ? options?.monthsDisplay
            : index === 2
              ? options?.weeksDisplay
              : index === 3
                ? options?.daysDisplay
                : index === 4
                  ? options?.hoursDisplay
                  : index === 5
                    ? options?.minutesDisplay
                    : index === 6
                      ? options?.secondsDisplay
                      : index === 7
                        ? options?.millisecondsDisplay
                        : index === 8
                          ? options?.microsecondsDisplay
                          : options?.nanosecondsDisplay;
      const display = stringOption(rawDisplay, displays, displayDefault);
      if (
        (code === 5 && display === "always") ||
        (previous === 5 && code !== 5) ||
        ((previous === 3 || previous === 4) && code < 3)
      )
        throw new RangeError("Conflicting duration unit styles");
      if (index === 4 && twoDigitHours && (code === 3 || code === 4)) code = 4;
      if ((index === 5 || index === 6) && (previous === 3 || previous === 4)) code = 4;
      this.#styles[index] = code;
      this.#displays[index] = display === "always" ? 1 : 0;
      if (index >= 4 && index <= 8) previous = code;
      if (code === 5 && firstFractional === 10) firstFractional = index;
      if ((code === 3 || code === 4) && firstNumeric === -1) firstNumeric = index;
    }
    const fractional = options?.fractionalDigits;
    this.fractionalDigits =
      fractional === undefined ? undefined : digits[numberOption(fractional, 0, 9, 0)]!;
    this.firstNumeric = firstNumeric;
    this.firstFractional = firstFractional;
  }

  code(index: number): number {
    return this.#styles[index]!;
  }
  always(index: number): boolean {
    return this.#displays[index] === 1;
  }
  private display(index: number): Intl.DurationFormatDisplayOption {
    return this.always(index) ? "always" : "auto";
  }
  get years(): Intl.ResolvedDurationFormatOptions["years"] {
    return textStyles[this.code(0)]!;
  }
  get months(): Intl.ResolvedDurationFormatOptions["months"] {
    return textStyles[this.code(1)]!;
  }
  get weeks(): Intl.ResolvedDurationFormatOptions["weeks"] {
    return textStyles[this.code(2)]!;
  }
  get days(): Intl.ResolvedDurationFormatOptions["days"] {
    return textStyles[this.code(3)]!;
  }
  get hours(): Intl.ResolvedDurationFormatOptions["hours"] {
    return unitStyles[this.code(4)]!;
  }
  get minutes(): Intl.ResolvedDurationFormatOptions["minutes"] {
    return unitStyles[this.code(5)]!;
  }
  get seconds(): Intl.ResolvedDurationFormatOptions["seconds"] {
    return unitStyles[this.code(6)]!;
  }
  get milliseconds(): Intl.ResolvedDurationFormatOptions["milliseconds"] {
    return fractionStyles[this.code(7) === 5 ? 3 : this.code(7)]!;
  }
  get microseconds(): Intl.ResolvedDurationFormatOptions["microseconds"] {
    return fractionStyles[this.code(8) === 5 ? 3 : this.code(8)]!;
  }
  get nanoseconds(): Intl.ResolvedDurationFormatOptions["nanoseconds"] {
    return fractionStyles[this.code(9) === 5 ? 3 : this.code(9)]!;
  }
  get yearsDisplay(): Intl.DurationFormatDisplayOption {
    return this.display(0);
  }
  get monthsDisplay(): Intl.DurationFormatDisplayOption {
    return this.display(1);
  }
  get weeksDisplay(): Intl.DurationFormatDisplayOption {
    return this.display(2);
  }
  get daysDisplay(): Intl.DurationFormatDisplayOption {
    return this.display(3);
  }
  get hoursDisplay(): Intl.DurationFormatDisplayOption {
    return this.display(4);
  }
  get minutesDisplay(): Intl.DurationFormatDisplayOption {
    return this.display(5);
  }
  get secondsDisplay(): Intl.DurationFormatDisplayOption {
    return this.display(6);
  }
  get millisecondsDisplay(): Intl.DurationFormatDisplayOption {
    return this.display(7);
  }
  get microsecondsDisplay(): Intl.DurationFormatDisplayOption {
    return this.display(8);
  }
  get nanosecondsDisplay(): Intl.DurationFormatDisplayOption {
    return this.display(9);
  }
}
