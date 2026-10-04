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
import { ZonedDateTime } from "../temporal/zoned-date-time.ts";
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
  #formatter: DateTimeFormatter<P> | undefined;
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
    timeZoneOverride: string | undefined = undefined,
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
      timeZoneOverride,
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
  #temporal(value: Date | number | bigint | Intl.FormattableTemporalObject): boolean {
    return (
      value instanceof PlainDate ||
      value instanceof PlainDateTime ||
      value instanceof PlainTime ||
      value instanceof PlainYearMonth ||
      value instanceof PlainMonthDay ||
      value instanceof Instant ||
      value instanceof ZonedDateTime
    );
  }
  get format(): Intl.DateTimeFormat["format"] {
    if (this.#bound === undefined)
      this.#bound = (date?: Parameters<Intl.DateTimeFormat["formatToParts"]>[0]): string => {
        if (date instanceof PlainYearMonth)
          return this.yearMonthFormatter(
            PlainYearMonth.calendarContext(date)?.identifier ?? "iso8601",
          ).format(PlainYearMonth.epochDay(date) * MS_PER_DAY + MS_PER_DAY / 2);
        if (date instanceof PlainMonthDay)
          return this.monthDayFormatter(
            PlainMonthDay.calendarContext(date)?.identifier ?? "iso8601",
          ).format(PlainMonthDay.epochDay(date) * MS_PER_DAY + MS_PER_DAY / 2);
        if (date instanceof PlainDateTime)
          return this.dateTimeFormatter(
            PlainDateTime.calendarContext(date)?.identifier ?? "iso8601",
          ).format(PlainDateTime.milliseconds(date));
        if (date instanceof Instant)
          return this.instantFormatter().format(Instant.epochMilliseconds(date));
        if (date instanceof PlainTime)
          return this.timeFormatter().format(Math.floor(PlainTime.nanoseconds(date) / 1e6));
        if (date instanceof PlainDate)
          return this.dateFormatter(
            PlainDate.calendarContext(date)?.identifier ?? "iso8601",
          ).format(PlainDate.epochDay(date) * MS_PER_DAY + MS_PER_DAY / 2);
        return this.#defaultFormatter().format(
          clip(date === undefined ? this.#clock() : this.#number(date)),
        );
      };
    return this.#bound;
  }
  #defaultFormatter(): DateTimeFormatter<P> {
    if (this.#formatter === undefined) {
      const config = this.#configuration;
      this.#formatter = new DateTimeFormatter(
        this.#open(config.dataLocale, config.pattern.pattern, config.timeZone),
      );
    }
    return this.#formatter;
  }
  // Slot entry point for Temporal/Date localization. It uses exactly the same
  // pattern selection, calendar validation and provider as public formatting.
  formatTemporal(kind: number, milliseconds: number, calendar: string): string {
    if (kind === 4 || kind === 5) {
      return (
        kind === 4 ? this.yearMonthFormatter(calendar) : this.monthDayFormatter(calendar)
      ).format(milliseconds);
    }
    if (kind === 6) this.requireCalendar(calendar, false);
    if (kind === 0 || kind === 6) return this.instantFormatter().format(milliseconds);
    if (kind === 1) return this.timeFormatter().format(milliseconds);
    if (kind === 2) return this.dateFormatter(calendar).format(milliseconds);
    if (kind === 3) return this.dateTimeFormatter(calendar).format(milliseconds);
    return this.#defaultFormatter().format(milliseconds);
  }
  private requireCalendar(calendar: string, partial: boolean): void {
    if ((partial || calendar !== "iso8601") && calendar !== this.#configuration.calendar)
      throw new RangeError("Temporal calendars must match the formatter");
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
  private dateFormatter(calendar: string): DateTimeFormatter<P> {
    this.requireCalendar(calendar, false);
    if (this.#plainDate === undefined) {
      const config = this.#configuration;
      this.#plainDate = new DateTimeFormatter(
        this.#open(config.dataLocale, config.plainDatePattern().pattern, "UTC"),
      );
    }
    return this.#plainDate;
  }
  private dateTimeFormatter(calendar: string): DateTimeFormatter<P> {
    this.requireCalendar(calendar, false);
    if (this.#plainDateTime === undefined) {
      const config = this.#configuration;
      this.#plainDateTime = new DateTimeFormatter(
        this.#open(config.dataLocale, config.plainDateTimePattern().pattern, "UTC"),
      );
    }
    return this.#plainDateTime;
  }
  private yearMonthFormatter(calendar: string): DateTimeFormatter<P> {
    this.requireCalendar(calendar, true);
    if (this.#plainYearMonth === undefined) {
      const config = this.#configuration;
      this.#plainYearMonth = new DateTimeFormatter(
        this.#open(config.dataLocale, config.plainPartialDatePattern(true).pattern, "UTC"),
      );
    }
    return this.#plainYearMonth;
  }
  private monthDayFormatter(calendar: string): DateTimeFormatter<P> {
    this.requireCalendar(calendar, true);
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
      return this.yearMonthFormatter(
        PlainYearMonth.calendarContext(date)?.identifier ?? "iso8601",
      ).formatToParts(PlainYearMonth.epochDay(date) * MS_PER_DAY + MS_PER_DAY / 2);
    if (date instanceof PlainMonthDay)
      return this.monthDayFormatter(
        PlainMonthDay.calendarContext(date)?.identifier ?? "iso8601",
      ).formatToParts(PlainMonthDay.epochDay(date) * MS_PER_DAY + MS_PER_DAY / 2);
    if (date instanceof PlainDateTime)
      return this.dateTimeFormatter(
        PlainDateTime.calendarContext(date)?.identifier ?? "iso8601",
      ).formatToParts(PlainDateTime.milliseconds(date));
    if (date instanceof Instant)
      return this.instantFormatter().formatToParts(Instant.epochMilliseconds(date));
    if (date instanceof PlainTime)
      return this.timeFormatter().formatToParts(Math.floor(PlainTime.nanoseconds(date) / 1e6));
    if (date instanceof PlainDate)
      return this.dateFormatter(
        PlainDate.calendarContext(date)?.identifier ?? "iso8601",
      ).formatToParts(PlainDate.epochDay(date) * MS_PER_DAY + MS_PER_DAY / 2);
    const formatter = this.#defaultFormatter();
    return formatter.formatToParts(clip(date === undefined ? this.#clock() : this.#number(date)));
  }
  formatRange(
    start: Parameters<Intl.DateTimeFormat["formatRange"]>[0] | bigint,
    end: Parameters<Intl.DateTimeFormat["formatRange"]>[1] | bigint,
  ): string {
    if (start === undefined || end === undefined)
      throw new TypeError("Date/time range endpoints are required");
    // ToDateTimeFormattable precedes type matching and TimeClip. Coerce both
    // numeric inputs once, in argument order, even for a mixed Temporal range.
    const first = this.#temporal(start) ? NaN : this.#number(start);
    const last = this.#temporal(end) ? NaN : this.#number(end);
    if (start instanceof PlainYearMonth || end instanceof PlainYearMonth) {
      if (!(start instanceof PlainYearMonth) || !(end instanceof PlainYearMonth))
        throw new TypeError("Temporal range endpoints must have the same type");
      this.requireCalendar(PlainYearMonth.calendarContext(end)?.identifier ?? "iso8601", true);
      return this.yearMonthFormatter(
        PlainYearMonth.calendarContext(start)?.identifier ?? "iso8601",
      ).formatRange(
        PlainYearMonth.epochDay(start) * MS_PER_DAY + MS_PER_DAY / 2,
        PlainYearMonth.epochDay(end) * MS_PER_DAY + MS_PER_DAY / 2,
      );
    }
    if (start instanceof PlainMonthDay || end instanceof PlainMonthDay) {
      if (!(start instanceof PlainMonthDay) || !(end instanceof PlainMonthDay))
        throw new TypeError("Temporal range endpoints must have the same type");
      this.requireCalendar(PlainMonthDay.calendarContext(end)?.identifier ?? "iso8601", true);
      return this.monthDayFormatter(
        PlainMonthDay.calendarContext(start)?.identifier ?? "iso8601",
      ).formatRange(
        PlainMonthDay.epochDay(start) * MS_PER_DAY + MS_PER_DAY / 2,
        PlainMonthDay.epochDay(end) * MS_PER_DAY + MS_PER_DAY / 2,
      );
    }
    if (start instanceof PlainDateTime || end instanceof PlainDateTime) {
      if (!(start instanceof PlainDateTime) || !(end instanceof PlainDateTime))
        throw new TypeError("Temporal range endpoints must have the same type");
      this.requireCalendar(PlainDateTime.calendarContext(end)?.identifier ?? "iso8601", false);
      return this.dateTimeFormatter(
        PlainDateTime.calendarContext(start)?.identifier ?? "iso8601",
      ).formatRange(PlainDateTime.milliseconds(start), PlainDateTime.milliseconds(end));
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
      this.requireCalendar(PlainDate.calendarContext(end)?.identifier ?? "iso8601", false);
      return this.dateFormatter(
        PlainDate.calendarContext(start)?.identifier ?? "iso8601",
      ).formatRange(
        PlainDate.epochDay(start) * MS_PER_DAY + MS_PER_DAY / 2,
        PlainDate.epochDay(end) * MS_PER_DAY + MS_PER_DAY / 2,
      );
    }
    if (start instanceof ZonedDateTime || end instanceof ZonedDateTime)
      throw new TypeError("Zoned date/time values require toLocaleString");
    return this.#defaultFormatter().formatRange(clip(first), clip(last));
  }
  formatRangeToParts(
    start: Parameters<Intl.DateTimeFormat["formatRangeToParts"]>[0] | bigint,
    end: Parameters<Intl.DateTimeFormat["formatRangeToParts"]>[1] | bigint,
  ): DateTimeRangeFormatPart[] {
    if (start === undefined || end === undefined)
      throw new TypeError("Date/time range endpoints are required");
    const first = this.#temporal(start) ? NaN : this.#number(start);
    const last = this.#temporal(end) ? NaN : this.#number(end);
    if (start instanceof PlainYearMonth || end instanceof PlainYearMonth) {
      if (!(start instanceof PlainYearMonth) || !(end instanceof PlainYearMonth))
        throw new TypeError("Temporal range endpoints must have the same type");
      this.requireCalendar(PlainYearMonth.calendarContext(end)?.identifier ?? "iso8601", true);
      return this.yearMonthFormatter(
        PlainYearMonth.calendarContext(start)?.identifier ?? "iso8601",
      ).formatRangeToParts(
        PlainYearMonth.epochDay(start) * MS_PER_DAY + MS_PER_DAY / 2,
        PlainYearMonth.epochDay(end) * MS_PER_DAY + MS_PER_DAY / 2,
      );
    }
    if (start instanceof PlainMonthDay || end instanceof PlainMonthDay) {
      if (!(start instanceof PlainMonthDay) || !(end instanceof PlainMonthDay))
        throw new TypeError("Temporal range endpoints must have the same type");
      this.requireCalendar(PlainMonthDay.calendarContext(end)?.identifier ?? "iso8601", true);
      return this.monthDayFormatter(
        PlainMonthDay.calendarContext(start)?.identifier ?? "iso8601",
      ).formatRangeToParts(
        PlainMonthDay.epochDay(start) * MS_PER_DAY + MS_PER_DAY / 2,
        PlainMonthDay.epochDay(end) * MS_PER_DAY + MS_PER_DAY / 2,
      );
    }
    if (start instanceof PlainDateTime || end instanceof PlainDateTime) {
      if (!(start instanceof PlainDateTime) || !(end instanceof PlainDateTime))
        throw new TypeError("Temporal range endpoints must have the same type");
      this.requireCalendar(PlainDateTime.calendarContext(end)?.identifier ?? "iso8601", false);
      return this.dateTimeFormatter(
        PlainDateTime.calendarContext(start)?.identifier ?? "iso8601",
      ).formatRangeToParts(PlainDateTime.milliseconds(start), PlainDateTime.milliseconds(end));
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
      this.requireCalendar(PlainDate.calendarContext(end)?.identifier ?? "iso8601", false);
      return this.dateFormatter(
        PlainDate.calendarContext(start)?.identifier ?? "iso8601",
      ).formatRangeToParts(
        PlainDate.epochDay(start) * MS_PER_DAY + MS_PER_DAY / 2,
        PlainDate.epochDay(end) * MS_PER_DAY + MS_PER_DAY / 2,
      );
    }
    if (start instanceof ZonedDateTime || end instanceof ZonedDateTime)
      throw new TypeError("Zoned date/time values require toLocaleString");
    return this.#defaultFormatter().formatRangeToParts(clip(first), clip(last));
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
