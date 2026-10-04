import { LocaleResolver } from "./locale.ts";
import type { LocaleData, NumberLocale } from "./locale.ts";
import { getCanonicalLocales } from "./locale-list.ts";
import type { ListPatternData } from "./list-data.ts";
import type { DurationPatternData } from "./duration-data.ts";
import type { NumberFormatterPrimitive } from "./number-data.ts";
import { DurationConfiguration } from "./duration-options.ts";
import { DurationPattern } from "./duration-pattern.ts";
import { DurationFormatter } from "./duration-format.ts";
import { Duration, toDuration } from "../temporal/duration.ts";

export class NtsDurationFormat<
  D extends LocaleData & ListPatternData & DurationPatternData,
  P extends NumberFormatterPrimitive,
>
  implements Intl.DurationFormat
{
  readonly #locale: NumberLocale;
  readonly #configuration: DurationConfiguration;
  readonly #formatter: DurationFormatter<D, P>;
  readonly #values = new Float64Array(10);

  constructor(
    resolver: LocaleResolver<D>,
    open: (locale: string, skeleton: string, negativeSkeleton: string) => P,
    locales: Intl.LocalesArgument = undefined,
    options: Readonly<Intl.DurationFormatOptions> | undefined = undefined,
  ) {
    const requested = getCanonicalLocales(resolver.data, locales);
    if (
      options !== undefined &&
      (options === null || (typeof options !== "object" && typeof options !== "function"))
    )
      throw new TypeError("Intl duration options must be an object");
    this.#locale = resolver.numberLocale(requested, options);
    const pattern = new DurationPattern(resolver.data.durationSamples(this.#locale.dataLocale));
    this.#configuration = new DurationConfiguration(options, pattern.twoDigitHours);
    this.#formatter = new DurationFormatter(
      resolver.data,
      open,
      this.#locale.dataLocale,
      this.#configuration,
      pattern,
    );
  }

  private duration(value: Temporal.DurationLike): boolean {
    if (
      value === null ||
      (typeof value !== "object" && typeof value !== "function" && typeof value !== "string")
    )
      throw new TypeError("DurationFormat requires a duration object");
    return Duration.copyFields(toDuration(value), this.#values) < 0;
  }
  // Temporal's Intl amendment also accepts duration strings; the pinned
  // DurationFormat library still declares only the field-bag input.
  format(value: Temporal.DurationLike): string {
    const formatter = this.#formatter;
    const negative = this.duration(value);
    return formatter.format(this.#values, negative);
  }
  formatToParts(value: Temporal.DurationLike): Intl.DurationFormatPart[] {
    const formatter = this.#formatter;
    const negative = this.duration(value);
    return formatter.formatToParts(this.#values, negative);
  }
  resolvedOptions(): Intl.ResolvedDurationFormatOptions {
    const config = this.#configuration;
    return {
      locale: this.#locale.locale,
      numberingSystem: this.#locale.numberingSystem,
      style: config.style,
      years: config.years,
      yearsDisplay: config.yearsDisplay,
      months: config.months,
      monthsDisplay: config.monthsDisplay,
      weeks: config.weeks,
      weeksDisplay: config.weeksDisplay,
      days: config.days,
      daysDisplay: config.daysDisplay,
      hours: config.hours,
      hoursDisplay: config.hoursDisplay,
      minutes: config.minutes,
      minutesDisplay: config.minutesDisplay,
      seconds: config.seconds,
      secondsDisplay: config.secondsDisplay,
      milliseconds: config.milliseconds,
      millisecondsDisplay: config.millisecondsDisplay,
      microseconds: config.microseconds,
      microsecondsDisplay: config.microsecondsDisplay,
      nanoseconds: config.nanoseconds,
      nanosecondsDisplay: config.nanosecondsDisplay,
      ...(config.fractionalDigits === undefined
        ? {}
        : { fractionalDigits: config.fractionalDigits }),
    };
  }
}
