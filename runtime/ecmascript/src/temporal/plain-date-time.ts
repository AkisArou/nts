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
import type { ResolvedTimeZone, TimeZoneSource } from "../time/zone-data.ts";
import { ISOParser } from "./iso-parser.ts";
import { PlainDate } from "./plain-date.ts";
import { PlainTime } from "./plain-time.ts";
import { ZonedDateTime } from "./zoned-date-time.ts";
import { resolveTimeZone } from "./zone-like.ts";
import { resolveLocalDateTime } from "./zoned-time.ts";
import { requireISOCalendarLike, isPlainCalendar } from "./plain-calendar.ts";
import { Duration, toDuration, unitNanoseconds } from "./duration.ts";
import { NS_PER_DAY, floorDivide, roundNanoseconds } from "./exact.ts";
import { calendarName, isoCalendarAnnotation, requireISOCalendar } from "./calendar-id.ts";
import {
  formatISODate,
  isoWeek,
  isoWeekYear,
  balanceISODate,
  regulateISODate,
} from "./iso-date.ts";
import {
  positiveDateField,
  isoMonthCode,
  resolveISOFields,
  regulateTimeField,
} from "./iso-fields.ts";
import { formatPlainTime, timeNanoseconds } from "./iso-time.ts";
import { checkDateTime, dateTimeUnitIndex, roundISODateTimeDifference } from "./iso-date-time.ts";
import {
  integerWithTruncation,
  disambiguationOption,
  overflowOption,
  requireOptions,
  roundingIncrement,
  roundingMode,
  validateIncrement,
  fractionalSecondDigits,
  secondsStringPrecision,
} from "./options.ts";

export function createPlainDateTime(day: number, time: number): PlainDateTime {
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

function fromFields(
  value: Readonly<Temporal.PartialTemporalLike<Temporal.DateTimeLikeObject>>,
  options: Readonly<Temporal.OverflowOptions> | undefined,
  previousDay?: number,
  previousTime = 0,
): PlainDateTime {
  // Prepare fields in alphabetical order, converting each before the next
  // getter. Keep the nine prepared numeric values in scalar locals.
  const rawDay = value.day;
  const day = rawDay === undefined ? undefined : positiveDateField(rawDay);
  const rawHour = value.hour;
  const hour =
    rawHour === undefined
      ? Math.floor(previousTime / 3600000000000)
      : integerWithTruncation(rawHour);
  const rawMicrosecond = value.microsecond;
  const microsecond =
    rawMicrosecond === undefined
      ? Math.floor(previousTime / 1000) % 1000
      : integerWithTruncation(rawMicrosecond);
  const rawMillisecond = value.millisecond;
  const millisecond =
    rawMillisecond === undefined
      ? Math.floor(previousTime / 1e6) % 1000
      : integerWithTruncation(rawMillisecond);
  const rawMinute = value.minute;
  const minute =
    rawMinute === undefined
      ? Math.floor(previousTime / 60000000000) % 60
      : integerWithTruncation(rawMinute);
  const rawMonth = value.month;
  const month = rawMonth === undefined ? undefined : positiveDateField(rawMonth);
  const rawCode = value.monthCode;
  const code = rawCode === undefined ? undefined : isoMonthCode(rawCode);
  const rawNanosecond = value.nanosecond;
  const nanosecond =
    rawNanosecond === undefined ? previousTime % 1000 : integerWithTruncation(rawNanosecond);
  const rawSecond = value.second;
  const second =
    rawSecond === undefined
      ? Math.floor(previousTime / 1e9) % 60
      : integerWithTruncation(rawSecond);
  const rawYear = value.year;
  const year = rawYear === undefined ? undefined : integerWithTruncation(rawYear);
  if (
    previousDay !== undefined &&
    rawDay === undefined &&
    rawHour === undefined &&
    rawMicrosecond === undefined &&
    rawMillisecond === undefined &&
    rawMinute === undefined &&
    rawMonth === undefined &&
    rawCode === undefined &&
    rawNanosecond === undefined &&
    rawSecond === undefined &&
    rawYear === undefined
  )
    throw new TypeError("At least one date-time field is required");
  const overflow = overflowOption(options);
  const resultDay = resolveISOFields(year, month, code, day, overflow, previousDay);
  const time = timeNanoseconds(
    regulateTimeField(hour, 23, overflow),
    regulateTimeField(minute, 59, overflow),
    regulateTimeField(second, 59, overflow),
    regulateTimeField(millisecond, 999, overflow),
    regulateTimeField(microsecond, 999, overflow),
    regulateTimeField(nanosecond, 999, overflow),
  );
  return createPlainDateTime(resultDay, time);
}

function dateTimeString(
  day: number,
  time: number,
  options?: Readonly<Temporal.PlainDateTimeToStringOptions>,
): string {
  const show = calendarName(options);
  const digits = fractionalSecondDigits(options?.fractionalSecondDigits);
  const mode = roundingMode(options?.roundingMode);
  const precision = secondsStringPrecision(options?.smallestUnit, digits);
  const increment =
    precision === -2 ? 60000000000n : BigInt(precision < 0 ? 1 : 10 ** (9 - precision));
  const rounded = roundNanoseconds(BigInt(time), increment, mode);
  const resultDay = day + Number(rounded / NS_PER_DAY);
  const resultTime = Number(rounded % NS_PER_DAY);
  checkDateTime(resultDay, resultTime);
  return (
    formatISODate(resultDay) +
    "T" +
    formatPlainTime(resultTime, precision) +
    isoCalendarAnnotation(show)
  );
}

// Both slots are exact binary64 integers. Getters and ordinary formatting do
// not construct intermediate dates, times, arrays or field records.
export class PlainDateTime {
  readonly #day: number;
  readonly #time: number;
  constructor(
    isoYear: number,
    isoMonth: number,
    isoDay: number,
    hour = 0,
    minute = 0,
    second = 0,
    millisecond = 0,
    microsecond = 0,
    nanosecond = 0,
    calendar = "iso8601",
  ) {
    const year = integerWithTruncation(isoYear);
    const month = integerWithTruncation(isoMonth);
    const day = integerWithTruncation(isoDay);
    const h = integerWithTruncation(hour);
    const m = integerWithTruncation(minute);
    const s = integerWithTruncation(second);
    const ms = integerWithTruncation(millisecond);
    const us = integerWithTruncation(microsecond);
    const ns = integerWithTruncation(nanosecond);
    requireISOCalendar(calendar);
    const date = regulateISODate(year, month, day, "reject");
    const time = timeNanoseconds(h, m, s, ms, us, ns);
    checkDateTime(date, time);
    this.#day = date;
    this.#time = time;
  }
  static epochDay(value: PlainDateTime): number {
    return value.#day;
  }
  static nanoseconds(value: PlainDateTime): number {
    return value.#time;
  }
  static milliseconds(value: PlainDateTime): number {
    return value.#day * MS_PER_DAY + Math.floor(value.#time / 1e6);
  }
  static from(
    value: Temporal.PlainDateTimeLike,
    options: Readonly<Temporal.OverflowOptions> | undefined = undefined,
  ): PlainDateTime {
    if (value instanceof ZonedDateTime) {
      const day = ZonedDateTime.epochDay(value);
      const time = ZonedDateTime.nanoseconds(value);
      overflowOption(options);
      return createPlainDateTime(day, time);
    }
    if (value instanceof PlainDateTime) {
      overflowOption(options);
      return createPlainDateTime(value.#day, value.#time);
    }
    if (value instanceof PlainDate) {
      overflowOption(options);
      return createPlainDateTime(PlainDate.epochDay(value), 0);
    }
    if (typeof value === "string") {
      const parsed = new ISOParser(value, false, true);
      if (parsed.utcDesignator)
        throw new RangeError("Plain date-time strings reject UTC designators");
      requireISOCalendar(parsed.calendar);
      overflowOption(options);
      return createPlainDateTime(
        regulateISODate(parsed.year, parsed.month, parsed.day, "reject"),
        parsed.timeNanoseconds(),
      );
    }
    if (value === null || typeof value !== "object")
      throw new TypeError("Date-time requires an object or string");
    const fields: Readonly<Temporal.DateTimeLikeObject> = value;
    const calendar = fields.calendar;
    if (calendar !== undefined) requireISOCalendarLike(calendar);
    return fromFields(fields, options);
  }
  static compare(one: Temporal.PlainDateTimeLike, two: Temporal.PlainDateTimeLike): number {
    const a = PlainDateTime.from(one);
    const b = PlainDateTime.from(two);
    return a.#day < b.#day
      ? -1
      : a.#day > b.#day
        ? 1
        : a.#time < b.#time
          ? -1
          : a.#time > b.#time
            ? 1
            : 0;
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
  get hour(): number {
    return Math.floor(this.#time / 3600000000000);
  }
  get minute(): number {
    return Math.floor(this.#time / 60000000000) % 60;
  }
  get second(): number {
    return Math.floor(this.#time / 1e9) % 60;
  }
  get millisecond(): number {
    return Math.floor(this.#time / 1e6) % 1000;
  }
  get microsecond(): number {
    return Math.floor(this.#time / 1000) % 1000;
  }
  get nanosecond(): number {
    return this.#time % 1000;
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
    value: Readonly<Temporal.PartialTemporalLike<Temporal.DateTimeLikeObject>>,
    options: Readonly<Temporal.OverflowOptions> | undefined = undefined,
  ): PlainDateTime {
    const day = this.#day;
    const time = this.#time;
    if (value === null || typeof value !== "object")
      throw new TypeError("Date-time fields must be an object");
    const fields: Readonly<
      Temporal.PartialTemporalLike<Temporal.DateTimeLikeObject> &
        Partial<Pick<Temporal.ZonedDateTimeLikeObject, "calendar" | "timeZone">>
    > = value;
    if (
      isPlainCalendar(value) ||
      value instanceof PlainTime ||
      fields.calendar !== undefined ||
      fields.timeZone !== undefined
    )
      throw new TypeError("with requires fields without a calendar or time zone");
    return fromFields(value, options, day, time);
  }
  toZonedDateTime(
    value: Temporal.TimeZoneLike | ZonedDateTime<ResolvedTimeZone>,
    options: Readonly<Temporal.DisambiguationOptions> | undefined = undefined,
    source: TimeZoneSource | undefined = undefined,
  ): ZonedDateTime<ResolvedTimeZone> {
    const day = this.#day;
    const time = this.#time;
    const zone = resolveTimeZone(value, source);
    if (options !== undefined) requireOptions(options);
    const disambiguation = disambiguationOption(options?.disambiguation);
    return new ZonedDateTime(resolveLocalDateTime(day, time, zone, disambiguation), zone);
  }
  withPlainTime(value: Temporal.PlainTimeLike | undefined = undefined): PlainDateTime {
    const day = this.#day;
    const time = value === undefined ? 0 : PlainTime.nanoseconds(PlainTime.from(value));
    return createPlainDateTime(day, time);
  }
  withCalendar(calendar: Temporal.CalendarLike): PlainDateTime {
    const day = this.#day;
    const time = this.#time;
    requireISOCalendarLike(calendar);
    return createPlainDateTime(day, time);
  }
  private addDuration(
    value: Temporal.DurationLike,
    options: Readonly<Temporal.OverflowOptions> | undefined,
    sign: number,
  ): PlainDateTime {
    const day = this.#day;
    const time = this.#time;
    const duration = toDuration(value);
    const overflow = overflowOption(options);
    const sum = BigInt(time) + Duration.timeNanoseconds(duration) * BigInt(sign);
    const days = floorDivide(sum, NS_PER_DAY);
    return createPlainDateTime(
      balanceISODate(
        day,
        duration.years * sign,
        duration.months * sign,
        duration.weeks * sign,
        Number(days),
        overflow,
      ),
      Number(sum - days * NS_PER_DAY),
    );
  }
  add(
    value: Temporal.DurationLike,
    options: Readonly<Temporal.OverflowOptions> | undefined = undefined,
  ): PlainDateTime {
    return this.addDuration(value, options, 1);
  }
  subtract(
    value: Temporal.DurationLike,
    options: Readonly<Temporal.OverflowOptions> | undefined = undefined,
  ): PlainDateTime {
    return this.addDuration(value, options, -1);
  }
  private difference(
    other: Temporal.PlainDateTimeLike,
    options:
      | Readonly<Temporal.RoundingOptionsWithLargestUnit<Temporal.DateUnit | Temporal.TimeUnit>>
      | undefined,
    since: boolean,
  ): Duration {
    const day = this.#day;
    const time = this.#time;
    const target = PlainDateTime.from(other);
    if (options !== undefined) requireOptions(options);
    const rawLargest = options?.largestUnit;
    if (typeof rawLargest === "symbol")
      throw new TypeError("Temporal string options reject Symbols");
    const largestText = rawLargest === undefined ? "auto" : String(rawLargest);
    const increment = roundingIncrement(options?.roundingIncrement);
    const mode = roundingMode(options?.roundingMode);
    const rawSmallest = options?.smallestUnit;
    const smallest = rawSmallest === undefined ? 9 : dateTimeUnitIndex(rawSmallest);
    const largest = largestText === "auto" ? Math.min(3, smallest) : dateTimeUnitIndex(largestText);
    if (largest > smallest) throw new RangeError("Invalid date-time difference unit order");
    if (smallest >= 4) validateIncrement(smallest, increment);
    const result = roundISODateTimeDifference(
      day,
      time,
      target.#day,
      target.#time,
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
    other: Temporal.PlainDateTimeLike,
    options:
      | Readonly<Temporal.RoundingOptionsWithLargestUnit<Temporal.DateUnit | Temporal.TimeUnit>>
      | undefined = undefined,
  ): Duration {
    return this.difference(other, options, false);
  }
  since(
    other: Temporal.PlainDateTimeLike,
    options:
      | Readonly<Temporal.RoundingOptionsWithLargestUnit<Temporal.DateUnit | Temporal.TimeUnit>>
      | undefined = undefined,
  ): Duration {
    return this.difference(other, options, true);
  }
  round(
    roundTo:
      | Temporal.PluralizeUnit<"day" | Temporal.TimeUnit>
      | Readonly<Temporal.RoundingOptions<"day" | Temporal.TimeUnit>>,
  ): PlainDateTime {
    const day = this.#day;
    const time = this.#time;
    if (roundTo === undefined || roundTo === null)
      throw new TypeError("Date-time.round requires options");
    let increment = 1;
    let mode = roundingMode("halfExpand");
    let unit: Temporal.PluralizeUnit<"day" | Temporal.TimeUnit> | undefined;
    if (typeof roundTo === "string") unit = roundTo;
    else {
      requireOptions(roundTo);
      increment = roundingIncrement(roundTo.roundingIncrement);
      const rawMode = roundTo.roundingMode;
      mode = roundingMode(rawMode === undefined ? "halfExpand" : rawMode);
      unit = roundTo.smallestUnit;
    }
    if (unit === undefined) throw new RangeError("smallestUnit required");
    const smallest = dateTimeUnitIndex(unit);
    if (smallest < 3 || (smallest === 3 && increment !== 1))
      throw new RangeError("Invalid date-time rounding unit or increment");
    validateIncrement(smallest, increment);
    const rounded = roundNanoseconds(
      BigInt(time),
      unitNanoseconds(smallest) * BigInt(increment),
      mode,
    );
    return createPlainDateTime(day + Number(rounded / NS_PER_DAY), Number(rounded % NS_PER_DAY));
  }
  equals(other: Temporal.PlainDateTimeLike): boolean {
    const day = this.#day;
    const time = this.#time;
    const target = PlainDateTime.from(other);
    return day === target.#day && time === target.#time;
  }
  toPlainDate(): PlainDate {
    const day = this.#day;
    const time = day * MS_PER_DAY;
    return new PlainDate(yearFromDays(day), monthFromTime(time) + 1, dateFromTime(time));
  }
  toPlainTime(): PlainTime {
    const time = this.#time;
    return new PlainTime(
      Math.floor(time / 3600000000000),
      Math.floor(time / 60000000000) % 60,
      Math.floor(time / 1e9) % 60,
      Math.floor(time / 1e6) % 1000,
      Math.floor(time / 1000) % 1000,
      time % 1000,
    );
  }
  toString(
    options: Readonly<Temporal.PlainDateTimeToStringOptions> | undefined = undefined,
  ): string {
    return dateTimeString(this.#day, this.#time, options);
  }
  toLocaleString(
    locales: Intl.LocalesArgument = undefined,
    options: Readonly<Intl.DateTimeFormatOptions> | undefined = undefined,
    source: TimeLocaleSource | undefined = undefined,
  ): string {
    this.#day;
    if (source === undefined) return dateTimeString(this.#day, this.#time);
    return source.formatDateTime(
      3,
      this.#day * MS_PER_DAY + Math.floor(this.#time / 1e6),
      "iso8601",
      locales,
      options,
      undefined,
    );
  }
  toJSON(): string {
    return dateTimeString(this.#day, this.#time);
  }
  valueOf(): never {
    throw new TypeError("Temporal.PlainDateTime cannot be converted to a primitive value");
  }
}
