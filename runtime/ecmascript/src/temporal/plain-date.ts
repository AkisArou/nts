import type { TimeLocaleSource } from "../time/locale-source.ts";
import {
  epochDays,
  yearFromDays,
  monthFromTime,
  dateFromTime,
  daysInMonth,
  isLeapYear,
  modulo,
  MS_PER_DAY,
} from "../date/calendar.ts";
import { pad } from "../date/format.ts";
import { ISOParser } from "./iso-parser.ts";
import { Duration, toDuration } from "./duration.ts";
import { NS_PER_DAY } from "./exact.ts";
import {
  integerWithTruncation,
  overflowOption,
  requireOptions,
  roundingIncrement,
  roundingMode,
} from "./options.ts";
import {
  checkDateDay,
  regulateISODate,
  dateUnitIndex,
  isoWeek,
  isoWeekYear,
  formatISODate,
} from "./iso-date.ts";
import type { ResolvedTimeZone, TimeZoneSource } from "../time/zone-data.ts";
import { roundDateDifference } from "./date-duration.ts";
import { dateFieldsDay } from "./date-fields.ts";
import { calendarName, calendarAnnotation } from "./calendar-id.ts";
import { CalendarContext } from "./calendar-context.ts";
import { resolveCalendar } from "./calendar-environment.ts";
import type { CalendarEnvironment } from "./calendar-environment.ts";
import { calendarEra, calendarEraYear } from "./calendar-eras.ts";
import { addDate } from "./calendar-date.ts";
import { PlainDateTime } from "./plain-date-time.ts";
import { ZonedDateTime } from "./zoned-date-time.ts";
import { resolveTimeZone } from "./zone-like.ts";
import { resolveLocalDateTime, startOfDay } from "./zoned-time.ts";
import { PlainTime } from "./plain-time.ts";
import { resolveCalendarLike, isPlainCalendar } from "./plain-calendar.ts";
import { PlainYearMonth } from "./plain-year-month.ts";
import { PlainMonthDay } from "./plain-month-day.ts";
function dateString(
  day: number,
  calendar: CalendarContext | undefined,
  options?: Readonly<Temporal.PlainDateToStringOptions>,
): string {
  const show = calendarName(options);
  return formatISODate(day) + calendarAnnotation(calendar?.identifier ?? "iso8601", show);
}

export function createPlainDate(
  day: number,
  calendar: CalendarContext | undefined = undefined,
): PlainDate {
  const time = day * MS_PER_DAY;
  return new PlainDate(yearFromDays(day), monthFromTime(time) + 1, dateFromTime(time), calendar);
}

// ISO days remain the value's chronology. A non-ISO context carries its
// calendar identity and immutable year cache; ISO needs no context allocation.
export class PlainDate {
  readonly #day: number;
  readonly #calendar: CalendarContext | undefined;
  constructor(
    isoYear: number,
    isoMonth: number,
    isoDay: number,
    calendar: string | CalendarContext = "iso8601",
    environment: CalendarEnvironment | undefined = undefined,
  ) {
    const year = integerWithTruncation(isoYear);
    const month = integerWithTruncation(isoMonth);
    const day = integerWithTruncation(isoDay);
    if (typeof calendar !== "string" && !(calendar instanceof CalendarContext))
      throw new TypeError("Calendar must be a string");
    this.#calendar =
      typeof calendar === "string" ? resolveCalendar(calendar, environment) : calendar;
    this.#day = checkDateDay(regulateISODate(year, month, day, "reject"));
  }
  static epochDay(value: PlainDate): number {
    return value.#day;
  }
  static calendarContext(value: PlainDate): CalendarContext | undefined {
    return value.#calendar;
  }
  static from(
    value: Temporal.PlainDateLike,
    options: Readonly<Temporal.OverflowOptions> | undefined = undefined,
    environment: CalendarEnvironment | undefined = undefined,
  ): PlainDate {
    if (value instanceof ZonedDateTime) {
      const day = ZonedDateTime.epochDay(value);
      overflowOption(options);
      return createPlainDate(day);
    }
    if (value instanceof PlainDate) {
      overflowOption(options);
      return createPlainDate(value.#day, value.#calendar);
    }
    if (value instanceof PlainDateTime) {
      overflowOption(options);
      return createPlainDate(PlainDateTime.epochDay(value));
    }
    if (typeof value === "string") {
      const parsed = new ISOParser(value, false, true);
      if (parsed.utcDesignator) throw new RangeError("Plain date strings reject UTC designators");
      const calendar = resolveCalendar(parsed.calendar, environment);
      overflowOption(options);
      return new PlainDate(parsed.year, parsed.month, parsed.day, calendar);
    }
    if (value === null || typeof value !== "object")
      throw new TypeError("Date requires a date, fields or string");
    const fields: Readonly<Temporal.DateLikeObject> = value;
    const rawCalendar = fields.calendar;
    const calendar =
      rawCalendar === undefined ? undefined : resolveCalendarLike(rawCalendar, environment);
    return createPlainDate(dateFieldsDay(value, options, calendar), calendar);
  }
  toZonedDateTime(
    value:
      | Temporal.TimeZoneLike
      | Readonly<Temporal.PlainDateToZonedDateTimeOptions>
      | ZonedDateTime<ResolvedTimeZone>,
    source: TimeZoneSource | undefined = undefined,
  ): ZonedDateTime<ResolvedTimeZone> {
    const day = this.#day;
    if (typeof value === "string" || value instanceof ZonedDateTime) {
      const zone = resolveTimeZone(value, source);
      return new ZonedDateTime(startOfDay(day, zone), zone, this.#calendar?.identifier);
    }
    if (value === null || (typeof value !== "object" && typeof value !== "function"))
      throw new TypeError("A zoned date requires a time zone or options object");
    const fields: Readonly<
      Partial<Temporal.ZonedDateTimeLikeObject> &
        Pick<Temporal.PlainDateToZonedDateTimeOptions, "plainTime">
    > = value;
    const rawZone = fields.timeZone;
    if (rawZone === undefined) throw new TypeError("A zoned date requires a timeZone");
    const zone = resolveTimeZone(rawZone, source);
    const time = fields.plainTime;
    const epoch =
      time === undefined
        ? startOfDay(day, zone)
        : resolveLocalDateTime(
            day,
            PlainTime.nanoseconds(PlainTime.from(time)),
            zone,
            "compatible",
          );
    return new ZonedDateTime(epoch, zone, this.#calendar?.identifier);
  }
  static compare(
    one: Temporal.PlainDateLike,
    two: Temporal.PlainDateLike,
    environment: CalendarEnvironment | undefined = undefined,
  ): number {
    const a = PlainDate.from(one, undefined, environment).#day;
    const b = PlainDate.from(two, undefined, environment).#day;
    return a < b ? -1 : a > b ? 1 : 0;
  }
  get calendarId(): string {
    this.#day;
    return this.#calendar?.identifier ?? "iso8601";
  }
  get era(): string | undefined {
    const day = this.#day;
    const calendar = this.#calendar;
    return calendar === undefined
      ? undefined
      : calendarEra(calendar.identifier, calendar.yearAt(day).year, day);
  }
  get eraYear(): number | undefined {
    const day = this.#day;
    const calendar = this.#calendar;
    if (calendar === undefined) return undefined;
    const year = calendar.yearAt(day).year;
    const era = calendarEra(calendar.identifier, year, day);
    return era === undefined ? undefined : calendarEraYear(calendar.identifier, era, year);
  }
  get year(): number {
    const day = this.#day;
    return this.#calendar === undefined ? yearFromDays(day) : this.#calendar.yearAt(day).year;
  }
  get month(): number {
    const day = this.#day;
    return this.#calendar === undefined
      ? monthFromTime(day * MS_PER_DAY) + 1
      : this.#calendar.yearAt(day).monthAt(day) + 1;
  }
  get monthCode(): string {
    const day = this.#day;
    if (this.#calendar === undefined) return "M" + pad(monthFromTime(day * MS_PER_DAY) + 1, 2);
    const year = this.#calendar.yearAt(day);
    return year.monthCode(year.monthAt(day));
  }
  get day(): number {
    const day = this.#day;
    if (this.#calendar === undefined) return dateFromTime(day * MS_PER_DAY);
    const year = this.#calendar.yearAt(day);
    return day - year.monthStart(year.monthAt(day)) + 1;
  }
  get dayOfWeek(): number {
    return modulo(this.#day + 3, 7) + 1;
  }
  get dayOfYear(): number {
    const day = this.#day;
    return (
      day -
      (this.#calendar === undefined
        ? epochDays(yearFromDays(day), 0, 1)
        : this.#calendar.yearAt(day).firstDay) +
      1
    );
  }
  get weekOfYear(): number | undefined {
    const day = this.#day;
    return this.#calendar === undefined ? isoWeek(day) : undefined;
  }
  get yearOfWeek(): number | undefined {
    const day = this.#day;
    return this.#calendar === undefined ? isoWeekYear(day) : undefined;
  }
  get daysInWeek(): number {
    this.#day;
    return 7;
  }
  get daysInMonth(): number {
    const day = this.#day;
    if (this.#calendar === undefined)
      return daysInMonth(yearFromDays(day), monthFromTime(day * MS_PER_DAY));
    const year = this.#calendar.yearAt(day);
    return year.daysInMonth(year.monthAt(day));
  }
  get daysInYear(): number {
    const day = this.#day;
    if (this.#calendar === undefined) return isLeapYear(yearFromDays(day)) ? 366 : 365;
    const year = this.#calendar.yearAt(day);
    return year.endDay - year.firstDay;
  }
  get monthsInYear(): number {
    this.#day;
    return this.#calendar === undefined ? 12 : this.#calendar.yearAt(this.#day).monthsInYear;
  }
  get inLeapYear(): boolean {
    const day = this.#day;
    return this.#calendar === undefined
      ? isLeapYear(yearFromDays(day))
      : this.#calendar.yearAt(day).inLeapYear;
  }
  with(
    value: Readonly<Temporal.PartialTemporalLike<Temporal.DateLikeObject>>,
    options: Readonly<Temporal.OverflowOptions> | undefined = undefined,
  ): PlainDate {
    const previous = this.#day;
    if (value === null || typeof value !== "object")
      throw new TypeError("Date fields must be an object");
    const fields: Readonly<
      Temporal.PartialTemporalLike<Temporal.DateLikeObject> &
        Partial<Pick<Temporal.ZonedDateTimeLikeObject, "calendar" | "timeZone">>
    > = value;
    if (
      isPlainCalendar(value) ||
      value instanceof PlainTime ||
      fields.calendar !== undefined ||
      fields.timeZone !== undefined
    )
      throw new TypeError("with requires date fields without a calendar or time zone");
    return createPlainDate(dateFieldsDay(value, options, this.#calendar, previous), this.#calendar);
  }
  withCalendar(
    calendar: Temporal.CalendarLike,
    environment: CalendarEnvironment | undefined = undefined,
  ): PlainDate {
    const day = this.#day;
    return createPlainDate(day, resolveCalendarLike(calendar, environment));
  }
  private addDuration(
    value: Temporal.DurationLike,
    options: Readonly<Temporal.OverflowOptions> | undefined,
    sign: number,
  ): PlainDate {
    const day = this.#day;
    const duration = toDuration(value);
    const days = Number(Duration.timeNanoseconds(duration) / NS_PER_DAY);
    const overflow = overflowOption(options);
    return createPlainDate(
      addDate(
        day,
        duration.years * sign,
        duration.months * sign,
        duration.weeks * sign,
        days * sign,
        overflow,
        this.#calendar,
      ),
      this.#calendar,
    );
  }
  add(
    value: Temporal.DurationLike,
    options: Readonly<Temporal.OverflowOptions> | undefined = undefined,
  ): PlainDate {
    return this.addDuration(value, options, 1);
  }
  subtract(
    value: Temporal.DurationLike,
    options: Readonly<Temporal.OverflowOptions> | undefined = undefined,
  ): PlainDate {
    return this.addDuration(value, options, -1);
  }
  private difference(
    other: Temporal.PlainDateLike,
    options: Readonly<Temporal.RoundingOptionsWithLargestUnit<Temporal.DateUnit>> | undefined,
    since: boolean,
    environment: CalendarEnvironment | undefined,
  ): Duration {
    const day = this.#day;
    const converted = PlainDate.from(other, undefined, environment);
    const target = converted.#day;
    if (
      (this.#calendar?.identifier ?? "iso8601") !== (converted.#calendar?.identifier ?? "iso8601")
    )
      throw new RangeError("Date difference requires matching calendars");
    if (options !== undefined) requireOptions(options);
    const rawLargest = options?.largestUnit;
    if (typeof rawLargest === "symbol")
      throw new TypeError("Temporal string options reject Symbols");
    const largestText = rawLargest === undefined ? "auto" : String(rawLargest);
    const increment = roundingIncrement(options?.roundingIncrement);
    const mode = roundingMode(options?.roundingMode);
    const rawSmallest = options?.smallestUnit;
    const smallest = rawSmallest === undefined ? 3 : dateUnitIndex(rawSmallest);
    const largest = largestText === "auto" ? smallest : dateUnitIndex(largestText);
    if (largest > smallest) throw new RangeError("Invalid date difference unit order");
    const result = roundDateDifference(
      day,
      target,
      largest,
      smallest,
      increment,
      !since
        ? mode
        : mode === "ceil"
          ? "floor"
          : mode === "floor"
            ? "ceil"
            : mode === "halfCeil"
              ? "halfFloor"
              : mode === "halfFloor"
                ? "halfCeil"
                : mode,
      this.#calendar,
    );
    return since ? result.negated() : result;
  }
  until(
    other: Temporal.PlainDateLike,
    options:
      | Readonly<Temporal.RoundingOptionsWithLargestUnit<Temporal.DateUnit>>
      | undefined = undefined,
    environment: CalendarEnvironment | undefined = undefined,
  ): Duration {
    return this.difference(other, options, false, environment);
  }
  since(
    other: Temporal.PlainDateLike,
    options:
      | Readonly<Temporal.RoundingOptionsWithLargestUnit<Temporal.DateUnit>>
      | undefined = undefined,
    environment: CalendarEnvironment | undefined = undefined,
  ): Duration {
    return this.difference(other, options, true, environment);
  }
  equals(
    other: Temporal.PlainDateLike,
    environment: CalendarEnvironment | undefined = undefined,
  ): boolean {
    const day = this.#day;
    const converted = PlainDate.from(other, undefined, environment);
    return (
      day === converted.#day &&
      (this.#calendar?.identifier ?? "iso8601") === (converted.#calendar?.identifier ?? "iso8601")
    );
  }
  toString(options: Readonly<Temporal.PlainDateToStringOptions> | undefined = undefined): string {
    return dateString(this.#day, this.#calendar, options);
  }
  toLocaleString(
    locales: Intl.LocalesArgument = undefined,
    options: Readonly<Intl.DateTimeFormatOptions> | undefined = undefined,
    source: TimeLocaleSource | undefined = undefined,
  ): string {
    this.#day;
    if (source === undefined) return dateString(this.#day, this.#calendar);
    return source.formatDateTime(
      2,
      this.#day * MS_PER_DAY + MS_PER_DAY / 2,
      this.#calendar?.identifier ?? "iso8601",
      locales,
      options,
      undefined,
    );
  }
  toJSON(): string {
    return dateString(this.#day, this.#calendar);
  }
  toPlainDateTime(value: Temporal.PlainTimeLike | undefined = undefined): PlainDateTime {
    const day = this.#day;
    const time = value === undefined ? 0 : PlainTime.nanoseconds(PlainTime.from(value));
    const milliseconds = day * MS_PER_DAY;
    return new PlainDateTime(
      yearFromDays(day),
      monthFromTime(milliseconds) + 1,
      dateFromTime(milliseconds),
      Math.floor(time / 3600000000000),
      Math.floor(time / 60000000000) % 60,
      Math.floor(time / 1e9) % 60,
      Math.floor(time / 1e6) % 1000,
      Math.floor(time / 1000) % 1000,
      time % 1000,
      this.#calendar?.identifier,
    );
  }
  toPlainYearMonth(): PlainYearMonth {
    const day = this.#day;
    if (this.#calendar === undefined)
      return new PlainYearMonth(yearFromDays(day), monthFromTime(day * MS_PER_DAY) + 1);
    return new PlainYearMonth(
      yearFromDays(day),
      monthFromTime(day * MS_PER_DAY) + 1,
      this.#calendar?.identifier,
      dateFromTime(day * MS_PER_DAY),
    );
  }
  toPlainMonthDay(): PlainMonthDay {
    const day = this.#day;
    if (this.#calendar === undefined)
      return new PlainMonthDay(monthFromTime(day * MS_PER_DAY) + 1, dateFromTime(day * MS_PER_DAY));
    return new PlainMonthDay(
      monthFromTime(day * MS_PER_DAY) + 1,
      dateFromTime(day * MS_PER_DAY),
      this.#calendar?.identifier,
      yearFromDays(day),
    );
  }
  valueOf(): never {
    throw new TypeError("Temporal.PlainDate cannot be converted to a primitive value");
  }
}
