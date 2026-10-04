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
  addISODate,
  dateUnitIndex,
  isoWeek,
  isoWeekYear,
  formatISODate,
} from "./iso-date.ts";
import type { ResolvedTimeZone, TimeZoneSource } from "../time/zone-data.ts";
import { roundISODateDifference } from "./iso-date-duration.ts";
import { positiveDateField, isoMonthCode, resolveISOFields } from "./iso-fields.ts";
import { requireISOCalendar, calendarName, isoCalendarAnnotation } from "./calendar-id.ts";
import { PlainDateTime } from "./plain-date-time.ts";
import { ZonedDateTime } from "./zoned-date-time.ts";
import { resolveTimeZone } from "./zone-like.ts";
import { resolveLocalDateTime, startOfDay } from "./zoned-time.ts";
import { PlainTime } from "./plain-time.ts";
import { requireISOCalendarLike, isPlainCalendar } from "./plain-calendar.ts";
import { PlainYearMonth } from "./plain-year-month.ts";
import { PlainMonthDay } from "./plain-month-day.ts";
function fieldsDay(
  value: Readonly<Temporal.PartialTemporalLike<Temporal.DateLikeObject>>,
  options: Readonly<Temporal.OverflowOptions> | undefined,
  previous?: number,
): number {
  const rawDay = value.day;
  const day = rawDay === undefined ? undefined : positiveDateField(rawDay);
  const rawMonth = value.month;
  const month = rawMonth === undefined ? undefined : positiveDateField(rawMonth);
  const rawCode = value.monthCode;
  const code = rawCode === undefined ? undefined : isoMonthCode(rawCode);
  const rawYear = value.year;
  const year = rawYear === undefined ? undefined : integerWithTruncation(rawYear);
  if (
    previous !== undefined &&
    rawDay === undefined &&
    rawMonth === undefined &&
    rawCode === undefined &&
    rawYear === undefined
  )
    throw new TypeError("At least one date field is required");
  const overflow = overflowOption(options);
  return checkDateDay(resolveISOFields(year, month, code, day, overflow, previous));
}

function dateString(day: number, options?: Readonly<Temporal.PlainDateToStringOptions>): string {
  const show = calendarName(options);
  return formatISODate(day) + isoCalendarAnnotation(show);
}

export function createPlainDate(day: number): PlainDate {
  const time = day * MS_PER_DAY;
  return new PlainDate(yearFromDays(day), monthFromTime(time) + 1, dateFromTime(time));
}

// Immutable ISO date stage. Calendar adapters and cross-type/localized methods
// extend this contract as they become executable; missing APIs stay visible.
export class PlainDate {
  readonly #day: number;
  constructor(isoYear: number, isoMonth: number, isoDay: number, calendar = "iso8601") {
    const year = integerWithTruncation(isoYear);
    const month = integerWithTruncation(isoMonth);
    const day = integerWithTruncation(isoDay);
    requireISOCalendar(calendar);
    this.#day = checkDateDay(regulateISODate(year, month, day, "reject"));
  }
  static epochDay(value: PlainDate): number {
    return value.#day;
  }
  static from(
    value: Temporal.PlainDateLike,
    options: Readonly<Temporal.OverflowOptions> | undefined = undefined,
  ): PlainDate {
    if (value instanceof ZonedDateTime) {
      const day = ZonedDateTime.epochDay(value);
      overflowOption(options);
      return createPlainDate(day);
    }
    if (value instanceof PlainDate) {
      overflowOption(options);
      return createPlainDate(value.#day);
    }
    if (value instanceof PlainDateTime) {
      overflowOption(options);
      return createPlainDate(PlainDateTime.epochDay(value));
    }
    if (typeof value === "string") {
      const parsed = new ISOParser(value, false, true);
      if (parsed.utcDesignator) throw new RangeError("Plain date strings reject UTC designators");
      requireISOCalendar(parsed.calendar);
      overflowOption(options);
      return new PlainDate(parsed.year, parsed.month, parsed.day);
    }
    if (value === null || typeof value !== "object")
      throw new TypeError("Date requires a date, fields or string");
    const fields: Readonly<Temporal.DateLikeObject> = value;
    const calendar = fields.calendar;
    if (calendar !== undefined) requireISOCalendarLike(calendar);
    return createPlainDate(fieldsDay(value, options));
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
      return new ZonedDateTime(startOfDay(day, zone), zone);
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
    return new ZonedDateTime(epoch, zone);
  }
  static compare(one: Temporal.PlainDateLike, two: Temporal.PlainDateLike): number {
    const a = PlainDate.from(one).#day;
    const b = PlainDate.from(two).#day;
    return a < b ? -1 : a > b ? 1 : 0;
  }
  get calendarId(): string {
    this.#day;
    return "iso8601";
  }
  get era(): undefined {
    this.#day;
    return undefined;
  }
  get eraYear(): undefined {
    this.#day;
    return undefined;
  }
  get year(): number {
    return yearFromDays(this.#day);
  }
  get month(): number {
    return monthFromTime(this.#day * MS_PER_DAY) + 1;
  }
  get monthCode(): string {
    return "M" + pad(monthFromTime(this.#day * MS_PER_DAY) + 1, 2);
  }
  get day(): number {
    return dateFromTime(this.#day * MS_PER_DAY);
  }
  get dayOfWeek(): number {
    return modulo(this.#day + 3, 7) + 1;
  }
  get dayOfYear(): number {
    return this.#day - epochDays(yearFromDays(this.#day), 0, 1) + 1;
  }
  get weekOfYear(): number {
    return isoWeek(this.#day);
  }
  get yearOfWeek(): number {
    return isoWeekYear(this.#day);
  }
  get daysInWeek(): number {
    this.#day;
    return 7;
  }
  get daysInMonth(): number {
    return daysInMonth(yearFromDays(this.#day), monthFromTime(this.#day * MS_PER_DAY));
  }
  get daysInYear(): number {
    return isLeapYear(yearFromDays(this.#day)) ? 366 : 365;
  }
  get monthsInYear(): number {
    this.#day;
    return 12;
  }
  get inLeapYear(): boolean {
    return isLeapYear(yearFromDays(this.#day));
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
    return createPlainDate(fieldsDay(value, options, previous));
  }
  withCalendar(calendar: Temporal.CalendarLike): PlainDate {
    const day = this.#day;
    requireISOCalendarLike(calendar);
    return createPlainDate(day);
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
      addISODate(
        day,
        duration.years * sign,
        duration.months * sign,
        duration.weeks * sign,
        days * sign,
        overflow,
      ),
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
  ): Duration {
    const day = this.#day;
    const target = PlainDate.from(other).#day;
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
    const result = roundISODateDifference(
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
    );
    return since ? result.negated() : result;
  }
  until(
    other: Temporal.PlainDateLike,
    options:
      | Readonly<Temporal.RoundingOptionsWithLargestUnit<Temporal.DateUnit>>
      | undefined = undefined,
  ): Duration {
    return this.difference(other, options, false);
  }
  since(
    other: Temporal.PlainDateLike,
    options:
      | Readonly<Temporal.RoundingOptionsWithLargestUnit<Temporal.DateUnit>>
      | undefined = undefined,
  ): Duration {
    return this.difference(other, options, true);
  }
  equals(other: Temporal.PlainDateLike): boolean {
    const day = this.#day;
    return day === PlainDate.from(other).#day;
  }
  toString(options: Readonly<Temporal.PlainDateToStringOptions> | undefined = undefined): string {
    return dateString(this.#day, options);
  }
  toLocaleString(
    locales: Intl.LocalesArgument = undefined,
    options: Readonly<Intl.DateTimeFormatOptions> | undefined = undefined,
    source: TimeLocaleSource | undefined = undefined,
  ): string {
    this.#day;
    if (source === undefined) return dateString(this.#day);
    return source.formatDateTime(
      2,
      this.#day * MS_PER_DAY + MS_PER_DAY / 2,
      "iso8601",
      locales,
      options,
      undefined,
    );
  }
  toJSON(): string {
    return dateString(this.#day);
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
    );
  }
  toPlainYearMonth(): PlainYearMonth {
    const day = this.#day;
    return new PlainYearMonth(yearFromDays(day), monthFromTime(day * MS_PER_DAY) + 1);
  }
  toPlainMonthDay(): PlainMonthDay {
    const day = this.#day;
    return new PlainMonthDay(monthFromTime(day * MS_PER_DAY) + 1, dateFromTime(day * MS_PER_DAY));
  }
  valueOf(): never {
    throw new TypeError("Temporal.PlainDate cannot be converted to a primitive value");
  }
}
