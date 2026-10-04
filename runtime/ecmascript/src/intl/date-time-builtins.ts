import { DateTimeFormatConfiguration } from "./date-time-options.ts";
import { DateTimeFormatter } from "./date-time.ts";
import type { DateTimeFormatPart, DateTimeRangeFormatPart } from "./date-time.ts";
import type { DateTimePatternData, DateTimeFormatterPrimitive } from "./date-time-data.ts";
import { LocaleResolver } from "./locale.ts";
import type { DateTimeLocaleData } from "./locale-data.ts";
import { getCanonicalLocales } from "./locale-list.ts";
import { TimeZoneRegistry } from "../time/zone-id.ts";
import type { TimeZoneIdentifierData } from "../time/zone-data.ts";
import { timeClip } from "../date/calendar.ts";
import { Instant } from "../temporal/builtins.ts";
import { PlainTime } from "../temporal/plain-time.ts";
import { PlainDate } from "../temporal/plain-date.ts";
import { PlainDateTime } from "../temporal/plain-date-time.ts";
import { PlainYearMonth } from "../temporal/plain-year-month.ts";
import { PlainMonthDay } from "../temporal/plain-month-day.ts";
import { MS_PER_DAY } from "../date/calendar.ts";

function clip(value: number): number {
  const result = timeClip(value);
  if (Number.isNaN(result)) throw new RangeError("Invalid date/time value");
  return result;
}

export class NtsDateTimeFormat<
  D extends DateTimeLocaleData & TimeZoneIdentifierData,
  G extends DateTimePatternData,
  P extends DateTimeFormatterPrimitive,
> {
  readonly #configuration: DateTimeFormatConfiguration<D, G>;
  readonly #formatter: DateTimeFormatter<P>;
  readonly #clock: () => number;
  readonly #open: (locale: string, pattern: string, timeZone: string) => P;
  #instant: DateTimeFormatter<P> | undefined;
  #plainTime: DateTimeFormatter<P> | undefined;
  #plainDate: DateTimeFormatter<P> | undefined;
  #plainDateTime: DateTimeFormatter<P> | undefined;
  #plainYearMonth: DateTimeFormatter<P> | undefined;
  #plainMonthDay: DateTimeFormatter<P> | undefined;
  #bound: Intl.DateTimeFormat["format"] | undefined;

  constructor(
    resolver: LocaleResolver<D>,
    timeZones: TimeZoneRegistry<D>,
    patterns: (locale: string) => G,
    open: (locale: string, pattern: string, timeZone: string) => P,
    clock: () => number,
    locales: Intl.LocalesArgument = undefined,
    options?: Readonly<Intl.DateTimeFormatOptions>,
    required: number = 0,
    defaults: number = 0,
  ) {
    const requested = getCanonicalLocales(resolver.data, locales);
    const configuration = new DateTimeFormatConfiguration(
      resolver,
      timeZones,
      patterns,
      requested,
      options,
      required,
      defaults,
    );
    this.#formatter = new DateTimeFormatter(
      open(configuration.dataLocale, configuration.pattern.pattern, configuration.timeZone),
    );
    this.#configuration = configuration;
    this.#clock = clock;
    this.#open = open;
  }
  #number(value: Date | number | bigint | Intl.FormattableTemporalObject | undefined): number {
    if (typeof value === "bigint" || typeof value === "symbol")
      throw new TypeError("Date/time inputs reject BigInts and Symbols");
    return Number(value);
  }
  get format(): Intl.DateTimeFormat["format"] {
    if (this.#bound === undefined)
      this.#bound = (date?: Parameters<Intl.DateTimeFormat["formatToParts"]>[0]): string => {
        if (date instanceof PlainYearMonth)
          return this.yearMonthFormatter().format(
            PlainYearMonth.epochDay(date) * MS_PER_DAY + MS_PER_DAY / 2,
          );
        if (date instanceof PlainMonthDay)
          return this.monthDayFormatter().format(
            PlainMonthDay.epochDay(date) * MS_PER_DAY + MS_PER_DAY / 2,
          );
        if (date instanceof PlainDateTime)
          return this.dateTimeFormatter().format(PlainDateTime.milliseconds(date));
        if (date instanceof Instant)
          return this.instantFormatter().format(Instant.epochMilliseconds(date));
        if (date instanceof PlainTime)
          return this.timeFormatter().format(Math.floor(PlainTime.nanoseconds(date) / 1e6));
        if (date instanceof PlainDate)
          return this.dateFormatter().format(
            PlainDate.epochDay(date) * MS_PER_DAY + MS_PER_DAY / 2,
          );
        return this.#formatter.format(
          clip(date === undefined ? this.#clock() : this.#number(date)),
        );
      };
    return this.#bound;
  }
  private instantFormatter(): DateTimeFormatter<P> {
    if (this.#instant === undefined) {
      const config = this.#configuration;
      this.#instant = new DateTimeFormatter(
        this.#open(config.dataLocale, config.instantPattern().pattern, config.timeZone),
      );
    }
    return this.#instant;
  }
  private timeFormatter(): DateTimeFormatter<P> {
    if (this.#plainTime === undefined) {
      const config = this.#configuration;
      this.#plainTime = new DateTimeFormatter(
        this.#open(config.dataLocale, config.plainTimePattern().pattern, "UTC"),
      );
    }
    return this.#plainTime;
  }
  private dateFormatter(): DateTimeFormatter<P> {
    if (this.#plainDate === undefined) {
      const config = this.#configuration;
      this.#plainDate = new DateTimeFormatter(
        this.#open(config.dataLocale, config.plainDatePattern().pattern, "UTC"),
      );
    }
    return this.#plainDate;
  }
  private dateTimeFormatter(): DateTimeFormatter<P> {
    if (this.#plainDateTime === undefined) {
      const config = this.#configuration;
      this.#plainDateTime = new DateTimeFormatter(
        this.#open(config.dataLocale, config.plainDateTimePattern().pattern, "UTC"),
      );
    }
    return this.#plainDateTime;
  }
  private yearMonthFormatter(): DateTimeFormatter<P> {
    if (this.#configuration.calendar !== "iso8601")
      throw new RangeError("Year-month calendars must match the formatter");
    if (this.#plainYearMonth === undefined) {
      const config = this.#configuration;
      this.#plainYearMonth = new DateTimeFormatter(
        this.#open(config.dataLocale, config.plainPartialDatePattern(true).pattern, "UTC"),
      );
    }
    return this.#plainYearMonth;
  }
  private monthDayFormatter(): DateTimeFormatter<P> {
    if (this.#configuration.calendar !== "iso8601")
      throw new RangeError("Month-day calendars must match the formatter");
    if (this.#plainMonthDay === undefined) {
      const config = this.#configuration;
      this.#plainMonthDay = new DateTimeFormatter(
        this.#open(config.dataLocale, config.plainPartialDatePattern(false).pattern, "UTC"),
      );
    }
    return this.#plainMonthDay;
  }
  formatToParts(date?: Parameters<Intl.DateTimeFormat["formatToParts"]>[0]): DateTimeFormatPart[] {
    if (date instanceof PlainYearMonth)
      return this.yearMonthFormatter().formatToParts(
        PlainYearMonth.epochDay(date) * MS_PER_DAY + MS_PER_DAY / 2,
      );
    if (date instanceof PlainMonthDay)
      return this.monthDayFormatter().formatToParts(
        PlainMonthDay.epochDay(date) * MS_PER_DAY + MS_PER_DAY / 2,
      );
    if (date instanceof PlainDateTime)
      return this.dateTimeFormatter().formatToParts(PlainDateTime.milliseconds(date));
    if (date instanceof Instant)
      return this.instantFormatter().formatToParts(Instant.epochMilliseconds(date));
    if (date instanceof PlainTime)
      return this.timeFormatter().formatToParts(Math.floor(PlainTime.nanoseconds(date) / 1e6));
    if (date instanceof PlainDate)
      return this.dateFormatter().formatToParts(
        PlainDate.epochDay(date) * MS_PER_DAY + MS_PER_DAY / 2,
      );
    const formatter = this.#formatter;
    return formatter.formatToParts(clip(date === undefined ? this.#clock() : this.#number(date)));
  }
  formatRange(
    start: Parameters<Intl.DateTimeFormat["formatRange"]>[0] | bigint,
    end: Parameters<Intl.DateTimeFormat["formatRange"]>[1] | bigint,
  ): string {
    const formatter = this.#formatter;
    if (start === undefined || end === undefined)
      throw new TypeError("Date/time range endpoints are required");
    if (start instanceof PlainYearMonth || end instanceof PlainYearMonth) {
      if (!(start instanceof PlainYearMonth) || !(end instanceof PlainYearMonth))
        throw new TypeError("Temporal range endpoints must have the same type");
      return this.yearMonthFormatter().formatRange(
        PlainYearMonth.epochDay(start) * MS_PER_DAY + MS_PER_DAY / 2,
        PlainYearMonth.epochDay(end) * MS_PER_DAY + MS_PER_DAY / 2,
      );
    }
    if (start instanceof PlainMonthDay || end instanceof PlainMonthDay) {
      if (!(start instanceof PlainMonthDay) || !(end instanceof PlainMonthDay))
        throw new TypeError("Temporal range endpoints must have the same type");
      return this.monthDayFormatter().formatRange(
        PlainMonthDay.epochDay(start) * MS_PER_DAY + MS_PER_DAY / 2,
        PlainMonthDay.epochDay(end) * MS_PER_DAY + MS_PER_DAY / 2,
      );
    }
    if (start instanceof PlainDateTime || end instanceof PlainDateTime) {
      if (!(start instanceof PlainDateTime) || !(end instanceof PlainDateTime))
        throw new TypeError("Temporal range endpoints must have the same type");
      return this.dateTimeFormatter().formatRange(
        PlainDateTime.milliseconds(start),
        PlainDateTime.milliseconds(end),
      );
    }
    if (start instanceof Instant || end instanceof Instant) {
      if (!(start instanceof Instant) || !(end instanceof Instant))
        throw new TypeError("Temporal range endpoints must have the same type");
      return this.instantFormatter().formatRange(
        Instant.epochMilliseconds(start),
        Instant.epochMilliseconds(end),
      );
    }
    if (start instanceof PlainTime || end instanceof PlainTime) {
      if (!(start instanceof PlainTime) || !(end instanceof PlainTime))
        throw new TypeError("Temporal range endpoints must have the same type");
      return this.timeFormatter().formatRange(
        Math.floor(PlainTime.nanoseconds(start) / 1e6),
        Math.floor(PlainTime.nanoseconds(end) / 1e6),
      );
    }
    if (start instanceof PlainDate || end instanceof PlainDate) {
      if (!(start instanceof PlainDate) || !(end instanceof PlainDate))
        throw new TypeError("Temporal range endpoints must have the same type");
      return this.dateFormatter().formatRange(
        PlainDate.epochDay(start) * MS_PER_DAY + MS_PER_DAY / 2,
        PlainDate.epochDay(end) * MS_PER_DAY + MS_PER_DAY / 2,
      );
    }
    const first = this.#number(start);
    const last = this.#number(end);
    return formatter.formatRange(clip(first), clip(last));
  }
  formatRangeToParts(
    start: Parameters<Intl.DateTimeFormat["formatRangeToParts"]>[0] | bigint,
    end: Parameters<Intl.DateTimeFormat["formatRangeToParts"]>[1] | bigint,
  ): DateTimeRangeFormatPart[] {
    const formatter = this.#formatter;
    if (start === undefined || end === undefined)
      throw new TypeError("Date/time range endpoints are required");
    if (start instanceof PlainYearMonth || end instanceof PlainYearMonth) {
      if (!(start instanceof PlainYearMonth) || !(end instanceof PlainYearMonth))
        throw new TypeError("Temporal range endpoints must have the same type");
      return this.yearMonthFormatter().formatRangeToParts(
        PlainYearMonth.epochDay(start) * MS_PER_DAY + MS_PER_DAY / 2,
        PlainYearMonth.epochDay(end) * MS_PER_DAY + MS_PER_DAY / 2,
      );
    }
    if (start instanceof PlainMonthDay || end instanceof PlainMonthDay) {
      if (!(start instanceof PlainMonthDay) || !(end instanceof PlainMonthDay))
        throw new TypeError("Temporal range endpoints must have the same type");
      return this.monthDayFormatter().formatRangeToParts(
        PlainMonthDay.epochDay(start) * MS_PER_DAY + MS_PER_DAY / 2,
        PlainMonthDay.epochDay(end) * MS_PER_DAY + MS_PER_DAY / 2,
      );
    }
    if (start instanceof PlainDateTime || end instanceof PlainDateTime) {
      if (!(start instanceof PlainDateTime) || !(end instanceof PlainDateTime))
        throw new TypeError("Temporal range endpoints must have the same type");
      return this.dateTimeFormatter().formatRangeToParts(
        PlainDateTime.milliseconds(start),
        PlainDateTime.milliseconds(end),
      );
    }
    if (start instanceof Instant || end instanceof Instant) {
      if (!(start instanceof Instant) || !(end instanceof Instant))
        throw new TypeError("Temporal range endpoints must have the same type");
      return this.instantFormatter().formatRangeToParts(
        Instant.epochMilliseconds(start),
        Instant.epochMilliseconds(end),
      );
    }
    if (start instanceof PlainTime || end instanceof PlainTime) {
      if (!(start instanceof PlainTime) || !(end instanceof PlainTime))
        throw new TypeError("Temporal range endpoints must have the same type");
      return this.timeFormatter().formatRangeToParts(
        Math.floor(PlainTime.nanoseconds(start) / 1e6),
        Math.floor(PlainTime.nanoseconds(end) / 1e6),
      );
    }
    if (start instanceof PlainDate || end instanceof PlainDate) {
      if (!(start instanceof PlainDate) || !(end instanceof PlainDate))
        throw new TypeError("Temporal range endpoints must have the same type");
      return this.dateFormatter().formatRangeToParts(
        PlainDate.epochDay(start) * MS_PER_DAY + MS_PER_DAY / 2,
        PlainDate.epochDay(end) * MS_PER_DAY + MS_PER_DAY / 2,
      );
    }
    const first = this.#number(start);
    const last = this.#number(end);
    return formatter.formatRangeToParts(clip(first), clip(last));
  }
  resolvedOptions(): Intl.ResolvedDateTimeFormatOptions {
    const config = this.#configuration;
    const fields = config.pattern.components;
    const styles = config.dateStyle !== undefined || config.timeStyle !== undefined;
    return {
      locale: config.locale,
      calendar: config.calendar,
      numberingSystem: config.numberingSystem,
      timeZone: config.timeZone,
      ...(fields.hour === undefined
        ? {}
        : {
            hourCycle: config.hourCycle,
            hour12: config.hourCycle === "h11" || config.hourCycle === "h12",
          }),
      ...(styles || fields.weekday === undefined ? {} : { weekday: fields.weekday }),
      ...(styles || fields.era === undefined ? {} : { era: fields.era }),
      ...(styles || fields.year === undefined ? {} : { year: fields.year }),
      ...(styles || fields.month === undefined ? {} : { month: fields.month }),
      ...(styles || fields.day === undefined ? {} : { day: fields.day }),
      ...(styles || fields.dayPeriod === undefined ? {} : { dayPeriod: fields.dayPeriod }),
      ...(styles || fields.hour === undefined ? {} : { hour: fields.hour }),
      ...(styles || fields.minute === undefined ? {} : { minute: fields.minute }),
      ...(styles || fields.second === undefined ? {} : { second: fields.second }),
      ...(styles || fields.fractionalSecondDigits === undefined
        ? {}
        : { fractionalSecondDigits: fields.fractionalSecondDigits }),
      ...(styles || fields.timeZoneName === undefined ? {} : { timeZoneName: fields.timeZoneName }),
      ...(config.dateStyle === undefined ? {} : { dateStyle: config.dateStyle }),
      ...(config.timeStyle === undefined ? {} : { timeStyle: config.timeStyle }),
    };
  }
}
