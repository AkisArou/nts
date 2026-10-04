import { LocaleResolver } from "./locale.ts";
import type { DateTimeLocaleData } from "./locale-data.ts";
import type { TimeZoneIdentifierData } from "../time/zone-data.ts";
import { TimeZoneRegistry } from "../time/zone-id.ts";
import type { DateTimePatternData, DateTimeFormatterPrimitive } from "./date-time-data.ts";
import type { NumberFormatterPrimitive } from "./number-data.ts";
import type { ListPatternData } from "./list-data.ts";
import type { DurationPatternData } from "./duration-data.ts";
import type { Duration } from "../temporal/duration.ts";
import type { CalendarEnvironment } from "../temporal/calendar-environment.ts";
import { NtsDateTimeFormat } from "./date-time-builtins.ts";
import { NtsDurationFormat } from "./duration.ts";

export class TimeLocaleContext<
  D extends DateTimeLocaleData & TimeZoneIdentifierData & ListPatternData & DurationPatternData,
  G extends DateTimePatternData,
  P extends DateTimeFormatterPrimitive,
  N extends NumberFormatterPrimitive,
> {
  readonly #resolver: LocaleResolver<D>;
  readonly #zones: TimeZoneRegistry<D>;
  readonly #patterns: (locale: string) => G;
  readonly #openDate: (locale: string, pattern: string, timeZone: string) => P;
  readonly #openNumber: (locale: string, skeleton: string, negativeSkeleton: string) => N;
  readonly #clock: () => number;
  readonly #environment: CalendarEnvironment | undefined;
  constructor(
    resolver: LocaleResolver<D>,
    zones: TimeZoneRegistry<D>,
    patterns: (locale: string) => G,
    openDate: (locale: string, pattern: string, timeZone: string) => P,
    openNumber: (locale: string, skeleton: string, negativeSkeleton: string) => N,
    clock: () => number,
    environment: CalendarEnvironment | undefined = undefined,
  ) {
    this.#resolver = resolver;
    this.#zones = zones;
    this.#patterns = patterns;
    this.#openDate = openDate;
    this.#openNumber = openNumber;
    this.#clock = clock;
    this.#environment = environment;
  }
  formatDateTime(
    kind: number,
    milliseconds: number,
    calendar: string,
    locales: Intl.LocalesArgument,
    options: Readonly<Intl.DateTimeFormatOptions> | undefined,
    timeZone: string | undefined,
  ): string {
    const required =
      kind === 1 || kind === 9 ? 2 : kind === 2 || kind === 4 || kind === 5 || kind === 8 ? 1 : 0;
    const defaults = required === 2 ? 1 : required === 1 ? 0 : 2;
    const formatter = new NtsDateTimeFormat(
      this.#resolver,
      this.#zones,
      this.#patterns,
      this.#openDate,
      this.#clock,
      locales,
      options,
      required,
      defaults,
      kind === 6 ? timeZone : undefined,
      this.#environment,
    );
    return formatter.formatTemporal(kind, milliseconds, calendar);
  }
  formatDuration(
    value: Duration,
    locales: Intl.LocalesArgument,
    options: Readonly<Intl.DurationFormatOptions> | undefined,
  ): string {
    return new NtsDurationFormat(this.#resolver, this.#openNumber, locales, options).format(value);
  }
}
