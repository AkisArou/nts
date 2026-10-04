import type { TimeLocaleSource } from "../time/locale-source.ts";
import type { ResolvedTimeZone, TimeZoneSource } from "../time/zone-data.ts";
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
import {
  checkInstant,
  epochMilliseconds,
  floorDivide,
  NS_PER_DAY,
  NS_PER_HOUR,
  NS_PER_MILLISECOND,
  negateRoundingMode,
} from "./exact.ts";
import { ISOParser } from "./iso-parser.ts";
import { requireISOCalendar, calendarName, isoCalendarAnnotation } from "./calendar-id.ts";
import { requireISOCalendarLike, isPlainCalendar } from "./plain-calendar.ts";
import { formatISODate, isoWeek, isoWeekYear, checkDateTime } from "./iso-date.ts";
import {
  positiveDateField,
  isoMonthCode,
  resolveISOFields,
  regulateTimeField,
} from "./iso-fields.ts";
import { formatPlainTime, timeNanoseconds } from "./iso-time.ts";
import { dateTimeUnitIndex } from "./iso-date-time.ts";
import {
  integerWithTruncation,
  requiredString,
  requireOptions,
  overflowOption,
  disambiguationOption,
  offsetOption,
  fractionalSecondDigits,
  roundingMode,
  roundingIncrement,
  temporalUnit,
  secondsStringPrecision,
  validateIncrement,
} from "./options.ts";
import { resolveTimeZone, resolveTimeZoneIdentifier } from "./zone-like.ts";
import {
  offsetNanoseconds,
  formatOffsetNanoseconds,
  formatRoundedOffset,
  resolveLocalDateTime,
  startOfDay,
  timeZoneTransitionMilliseconds,
} from "./zoned-time.ts";
import { addISOZonedDateTime, roundISOZonedDateTime } from "./zoned-iso.ts";
import { roundISOZonedDifference } from "./zoned-difference.ts";
import { fromDateTimeFields } from "./date-time-fields.ts";
import { Duration, toDuration } from "./duration.ts";
import { Instant } from "./instant-object.ts";
import { roundInstant } from "./instant.ts";
import { PlainDate, createPlainDate } from "./plain-date.ts";
import { PlainTime, createPlainTime } from "./plain-time.ts";
import { PlainDateTime, createPlainDateTime } from "./plain-date-time.ts";

function stringField(value: string): string {
  if (typeof value === "symbol") throw new TypeError("Temporal string fields reject Symbols");
  return String(value);
}

// The standard constructor binding resolves its string into this typed rule
// snapshot before allocation, as Date's binding supplies converted milliseconds.
// Generic provider storage preserves concrete layouts on compiled backends.
// Immutable local scalars are derived once; getters allocate no records or
// query ICU. Calendar conversion and localization remain open.
export class ZonedDateTime<Z extends ResolvedTimeZone> {
  readonly #epoch: bigint;
  readonly #zone: Z;
  readonly #day: number;
  readonly #time: number;
  readonly #offset: number;

  constructor(epochNanoseconds: bigint, zone: Z, calendar = "iso8601") {
    if (typeof epochNanoseconds !== "bigint")
      throw new TypeError("Epoch nanoseconds must be a BigInt");
    this.#epoch = checkInstant(epochNanoseconds);
    requireISOCalendar(calendar);
    this.#zone = zone;
    const offset = offsetNanoseconds(epochNanoseconds, zone);
    const local = epochNanoseconds + offset;
    const day = floorDivide(local, NS_PER_DAY);
    this.#day = Number(day);
    this.#time = Number(local - day * NS_PER_DAY);
    this.#offset = Number(offset);
  }
  static epochNanoseconds(value: ZonedDateTime<ResolvedTimeZone>): bigint {
    return value.#epoch;
  }
  static epochDay(value: ZonedDateTime<ResolvedTimeZone>): number {
    return value.#day;
  }
  static nanoseconds(value: ZonedDateTime<ResolvedTimeZone>): number {
    return value.#time;
  }
  static rules<R extends ResolvedTimeZone>(value: ZonedDateTime<R>): R {
    return value.#zone;
  }

  static from(
    value: Temporal.ZonedDateTimeLike | ZonedDateTime<ResolvedTimeZone>,
    options: Readonly<Temporal.ZonedDateTimeFromOptions> | undefined = undefined,
    source: TimeZoneSource | undefined = undefined,
  ): ZonedDateTime<ResolvedTimeZone> {
    if (value instanceof ZonedDateTime) {
      const epoch = value.#epoch;
      if (options !== undefined) requireOptions(options);
      disambiguationOption(options?.disambiguation);
      offsetOption(options?.offset, "reject");
      overflowOption(options);
      return new ZonedDateTime(epoch, value.#zone);
    }
    if (typeof value === "string")
      return ZonedDateTime.fromParsed(new ISOParser(value, false, true), options, source);
    if (value === null || (typeof value !== "object" && typeof value !== "function"))
      throw new TypeError("Zoned date-time requires an object or string");
    return fromDateTimeFields(value, options, source, true);
  }
  static fromParsed(
    parsed: ISOParser,
    options: Readonly<Temporal.ZonedDateTimeFromOptions> | undefined,
    source: TimeZoneSource | undefined,
  ): ZonedDateTime<ResolvedTimeZone> {
    if (parsed.timeZone === undefined)
      throw new RangeError("Zoned date-time strings require a time-zone annotation");
    const zone = resolveTimeZoneIdentifier(parsed.timeZone, source);
    requireISOCalendar(parsed.calendar);
    if (options !== undefined) requireOptions(options);
    const disambiguation = disambiguationOption(options?.disambiguation);
    const offset = offsetOption(options?.offset, "reject");
    overflowOption(options);
    const day = epochDays(parsed.year, parsed.month - 1, parsed.day);
    const time = parsed.timeNanoseconds();
    const epoch = !parsed.hasTime
      ? startOfDay(day, zone)
      : resolveLocalDateTime(
          day,
          time,
          zone,
          disambiguation,
          parsed.utcDesignator ? "use" : !parsed.hasOffset ? "ignore" : offset,
          parsed.offsetNanoseconds,
          !parsed.offsetHasSeconds,
        );
    return new ZonedDateTime(epoch, zone);
  }
  static compare(
    one: Temporal.ZonedDateTimeLike | ZonedDateTime<ResolvedTimeZone>,
    two: Temporal.ZonedDateTimeLike | ZonedDateTime<ResolvedTimeZone>,
    source: TimeZoneSource | undefined = undefined,
  ): number {
    const a = ZonedDateTime.from(one, undefined, source).#epoch;
    const b = ZonedDateTime.from(two, undefined, source).#epoch;
    return a < b ? -1 : a > b ? 1 : 0;
  }
  get calendarId(): string {
    this.#epoch;
    return "iso8601";
  }
  get timeZoneId(): string {
    return this.#zone.id;
  }
  get era(): undefined {
    this.#epoch;
    return undefined;
  }
  get eraYear(): undefined {
    this.#epoch;
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
  get epochMilliseconds(): number {
    return epochMilliseconds(this.#epoch);
  }
  get epochNanoseconds(): bigint {
    return this.#epoch;
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
  get hoursInDay(): number {
    return (
      Number(startOfDay(this.#day + 1, this.#zone) - startOfDay(this.#day, this.#zone)) /
      Number(NS_PER_HOUR)
    );
  }
  get daysInWeek(): number {
    this.#epoch;
    return 7;
  }
  get daysInMonth(): number {
    return daysInMonth(yearFromDays(this.#day), monthFromTime(this.#day * MS_PER_DAY));
  }
  get daysInYear(): number {
    return isLeapYear(yearFromDays(this.#day)) ? 366 : 365;
  }
  get monthsInYear(): number {
    this.#epoch;
    return 12;
  }
  get inLeapYear(): boolean {
    return isLeapYear(yearFromDays(this.#day));
  }
  get offsetNanoseconds(): number {
    return this.#offset;
  }
  get offset(): string {
    return formatOffsetNanoseconds(BigInt(this.#offset));
  }

  with(
    value: Readonly<Temporal.PartialTemporalLike<Temporal.ZonedDateTimeLikeObject>>,
    options: Readonly<Temporal.ZonedDateTimeFromOptions> | undefined = undefined,
  ): ZonedDateTime<Z> {
    const previousDay = this.#day;
    const previousTime = this.#time;
    if (value === null || (typeof value !== "object" && typeof value !== "function"))
      throw new TypeError("Zoned date-time fields must be an object");
    const fields: Readonly<Partial<Temporal.ZonedDateTimeLikeObject>> = value;
    if (
      isPlainCalendar(value) ||
      value instanceof PlainTime ||
      fields.calendar !== undefined ||
      fields.timeZone !== undefined
    )
      throw new TypeError("with requires fields without a calendar or time zone");
    const rawDay = fields.day;
    const day = rawDay === undefined ? undefined : positiveDateField(rawDay);
    const rawHour = fields.hour;
    const hour =
      rawHour === undefined
        ? Math.floor(previousTime / 3600000000000)
        : integerWithTruncation(rawHour);
    const rawMicrosecond = fields.microsecond;
    const microsecond =
      rawMicrosecond === undefined
        ? Math.floor(previousTime / 1000) % 1000
        : integerWithTruncation(rawMicrosecond);
    const rawMillisecond = fields.millisecond;
    const millisecond =
      rawMillisecond === undefined
        ? Math.floor(previousTime / 1e6) % 1000
        : integerWithTruncation(rawMillisecond);
    const rawMinute = fields.minute;
    const minute =
      rawMinute === undefined
        ? Math.floor(previousTime / 60000000000) % 60
        : integerWithTruncation(rawMinute);
    const rawMonth = fields.month;
    const month = rawMonth === undefined ? undefined : positiveDateField(rawMonth);
    const rawCode = fields.monthCode;
    const code = rawCode === undefined ? undefined : isoMonthCode(rawCode);
    const rawNanosecond = fields.nanosecond;
    const nanosecond =
      rawNanosecond === undefined ? previousTime % 1000 : integerWithTruncation(rawNanosecond);
    const rawOffset = fields.offset;
    const offset =
      rawOffset === undefined
        ? BigInt(this.#offset)
        : ISOParser.parseUTCOffset(requiredString(rawOffset));
    const rawSecond = fields.second;
    const second =
      rawSecond === undefined
        ? Math.floor(previousTime / 1e9) % 60
        : integerWithTruncation(rawSecond);
    const rawYear = fields.year;
    const year = rawYear === undefined ? undefined : integerWithTruncation(rawYear);
    if (
      rawDay === undefined &&
      rawHour === undefined &&
      rawMicrosecond === undefined &&
      rawMillisecond === undefined &&
      rawMinute === undefined &&
      rawMonth === undefined &&
      rawCode === undefined &&
      rawNanosecond === undefined &&
      rawOffset === undefined &&
      rawSecond === undefined &&
      rawYear === undefined
    )
      throw new TypeError("At least one zoned date-time field is required");
    if (options !== undefined) requireOptions(options);
    const disambiguation = disambiguationOption(options?.disambiguation);
    const offsetChoice = offsetOption(options?.offset, "prefer");
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
    checkDateTime(resultDay, time);
    return new ZonedDateTime(
      resolveLocalDateTime(resultDay, time, this.#zone, disambiguation, offsetChoice, offset),
      this.#zone,
    );
  }

  withPlainTime(value: Temporal.PlainTimeLike | undefined = undefined): ZonedDateTime<Z> {
    const day = this.#day;
    const epoch =
      value === undefined
        ? startOfDay(day, this.#zone)
        : resolveLocalDateTime(
            day,
            PlainTime.nanoseconds(PlainTime.from(value)),
            this.#zone,
            "compatible",
          );
    return new ZonedDateTime(epoch, this.#zone);
  }
  withTimeZone(
    value: Temporal.TimeZoneLike | ZonedDateTime<ResolvedTimeZone>,
    source: TimeZoneSource | undefined = undefined,
  ): ZonedDateTime<ResolvedTimeZone> {
    const epoch = this.#epoch;
    return new ZonedDateTime(epoch, resolveTimeZone(value, source));
  }
  withCalendar(value: Temporal.CalendarLike | ZonedDateTime<ResolvedTimeZone>): ZonedDateTime<Z> {
    const epoch = this.#epoch;
    if (value instanceof ZonedDateTime) value.#epoch;
    else requireISOCalendarLike(value);
    return new ZonedDateTime(epoch, this.#zone);
  }
  #addDuration(
    value: Temporal.DurationLike,
    options: Readonly<Temporal.OverflowOptions> | undefined,
    sign: number,
  ): ZonedDateTime<Z> {
    const epoch = this.#epoch;
    const duration = toDuration(value);
    const overflow = overflowOption(options);
    const days = Duration.field(duration, 3);
    return new ZonedDateTime(
      addISOZonedDateTime(
        epoch,
        this.#zone,
        Duration.field(duration, 0) * sign,
        Duration.field(duration, 1) * sign,
        Duration.field(duration, 2) * sign,
        days * sign,
        (Duration.timeNanoseconds(duration) - BigInt(days) * NS_PER_DAY) * BigInt(sign),
        overflow,
      ),
      this.#zone,
    );
  }
  add(
    value: Temporal.DurationLike,
    options: Readonly<Temporal.OverflowOptions> | undefined = undefined,
  ): ZonedDateTime<Z> {
    return this.#addDuration(value, options, 1);
  }
  subtract(
    value: Temporal.DurationLike,
    options: Readonly<Temporal.OverflowOptions> | undefined = undefined,
  ): ZonedDateTime<Z> {
    return this.#addDuration(value, options, -1);
  }
  #difference(
    other: Temporal.ZonedDateTimeLike | ZonedDateTime<ResolvedTimeZone>,
    options:
      | Readonly<Temporal.RoundingOptionsWithLargestUnit<Temporal.DateUnit | Temporal.TimeUnit>>
      | undefined,
    since: boolean,
    source: TimeZoneSource | undefined,
  ): Duration {
    const epoch = this.#epoch;
    const target =
      other instanceof ZonedDateTime ? other : ZonedDateTime.from(other, undefined, source);
    const targetEpoch = target.#epoch;
    if (options !== undefined) requireOptions(options);
    const rawLargest = options?.largestUnit;
    if (typeof rawLargest === "symbol")
      throw new TypeError("Temporal string options reject Symbols");
    const largestText = rawLargest === undefined ? "auto" : String(rawLargest);
    const largestUnit = largestText === "auto" ? undefined : temporalUnit(largestText);
    const increment = roundingIncrement(options?.roundingIncrement);
    const mode = roundingMode(options?.roundingMode);
    const smallestUnit = temporalUnit(options?.smallestUnit);
    const smallest = smallestUnit === undefined ? 9 : dateTimeUnitIndex(smallestUnit);
    const largest =
      largestUnit === undefined ? Math.min(4, smallest) : dateTimeUnitIndex(largestUnit);
    if (largest > smallest) throw new RangeError("Invalid zoned difference unit order");
    if (smallest >= 4) validateIncrement(smallest, increment);
    if (largest <= 3 && this.#zone.primaryId !== target.#zone.primaryId)
      throw new RangeError("Calendar differences require equivalent time zones");
    if (epoch === targetEpoch) return new Duration();
    const result = roundISOZonedDifference(
      epoch,
      targetEpoch,
      this.#zone,
      largest,
      smallest,
      increment,
      since ? negateRoundingMode(mode) : mode,
    );
    return since ? result.negated() : result;
  }
  until(
    other: Temporal.ZonedDateTimeLike | ZonedDateTime<ResolvedTimeZone>,
    options:
      | Readonly<Temporal.RoundingOptionsWithLargestUnit<Temporal.DateUnit | Temporal.TimeUnit>>
      | undefined = undefined,
    source: TimeZoneSource | undefined = undefined,
  ): Duration {
    return this.#difference(other, options, false, source);
  }
  since(
    other: Temporal.ZonedDateTimeLike | ZonedDateTime<ResolvedTimeZone>,
    options:
      | Readonly<Temporal.RoundingOptionsWithLargestUnit<Temporal.DateUnit | Temporal.TimeUnit>>
      | undefined = undefined,
    source: TimeZoneSource | undefined = undefined,
  ): Duration {
    return this.#difference(other, options, true, source);
  }
  round(
    value:
      | Temporal.PluralizeUnit<"day" | Temporal.TimeUnit>
      | Readonly<Temporal.RoundingOptions<"day" | Temporal.TimeUnit>>,
  ): ZonedDateTime<Z> {
    const epoch = this.#epoch;
    let increment = 1;
    let mode = roundingMode("halfExpand");
    let unit: string | undefined;
    if (typeof value === "string") unit = temporalUnit(value);
    else {
      requireOptions(value);
      increment = roundingIncrement(value.roundingIncrement);
      const rawMode = value.roundingMode;
      mode = roundingMode(rawMode === undefined ? "halfExpand" : rawMode);
      unit = temporalUnit(value.smallestUnit);
    }
    if (unit === undefined) throw new RangeError("smallestUnit is required");
    const index = dateTimeUnitIndex(unit);
    if (index < 3) throw new RangeError("Zoned rounding requires day or time units");
    if (index === 3) {
      if (increment !== 1) throw new RangeError("Day rounding requires an increment of one");
    } else validateIncrement(index, increment);
    return new ZonedDateTime(
      roundISOZonedDateTime(epoch, this.#zone, index, increment, mode),
      this.#zone,
    );
  }
  equals(
    other: Temporal.ZonedDateTimeLike | ZonedDateTime<ResolvedTimeZone>,
    source: TimeZoneSource | undefined = undefined,
  ): boolean {
    const epoch = this.#epoch;
    const target = ZonedDateTime.from(other, undefined, source);
    return epoch === target.#epoch && this.#zone.primaryId === target.#zone.primaryId;
  }
  #formatString(options: Readonly<Temporal.ZonedDateTimeToStringOptions> | undefined): string {
    const epoch = this.#epoch;
    if (options !== undefined) requireOptions(options);
    const calendar = calendarName(options);
    const digits = fractionalSecondDigits(options?.fractionalSecondDigits);
    const rawOffset = options?.offset;
    const showOffset = rawOffset === undefined ? "auto" : stringField(rawOffset);
    if (showOffset !== "auto" && showOffset !== "never")
      throw new RangeError("Invalid show-offset option");
    const mode = roundingMode(options?.roundingMode);
    const unit = temporalUnit(options?.smallestUnit);
    const rawName = options?.timeZoneName;
    const showName = rawName === undefined ? "auto" : stringField(rawName);
    if (showName !== "auto" && showName !== "never" && showName !== "critical")
      throw new RangeError("Invalid time-zone-name option");
    const precision = secondsStringPrecision(unit, digits);
    const increment = precision === -2 ? 60000000000 : precision < 0 ? 1 : 10 ** (9 - precision);
    const rounded = roundInstant(epoch, "nanosecond", increment, mode);
    const offset = offsetNanoseconds(rounded, this.#zone);
    const local = rounded + offset;
    const day = floorDivide(local, NS_PER_DAY);
    return (
      formatISODate(Number(day)) +
      "T" +
      formatPlainTime(Number(local - day * NS_PER_DAY), precision) +
      (showOffset === "never" ? "" : formatRoundedOffset(offset)) +
      (showName === "never"
        ? ""
        : "[" + (showName === "critical" ? "!" : "") + this.#zone.id + "]") +
      isoCalendarAnnotation(calendar)
    );
  }
  toString(
    options: Readonly<Temporal.ZonedDateTimeToStringOptions> | undefined = undefined,
  ): string {
    return this.#formatString(options);
  }
  toLocaleString(
    locales: Intl.LocalesArgument = undefined,
    options: Readonly<Intl.DateTimeFormatOptions> | undefined = undefined,
    source: TimeLocaleSource | undefined = undefined,
  ): string {
    this.#epoch;
    if (source === undefined) return this.#formatString(undefined);
    return source.formatDateTime(
      6,
      epochMilliseconds(this.#epoch),
      "iso8601",
      locales,
      options,
      this.#zone.id,
    );
  }
  toJSON(): string {
    return this.#formatString(undefined);
  }
  valueOf(): never {
    throw new TypeError("Temporal.ZonedDateTime cannot be converted to a primitive value");
  }
  startOfDay(): ZonedDateTime<Z> {
    return new ZonedDateTime(startOfDay(this.#day, this.#zone), this.#zone);
  }
  getTimeZoneTransition(
    value: "next" | "previous" | Readonly<Temporal.TransitionOptions>,
  ): ZonedDateTime<Z> | null {
    const epoch = this.#epoch;
    let direction: string;
    if (typeof value === "string") direction = value;
    else {
      requireOptions(value);
      direction = stringField(value.direction);
    }
    if (direction !== "next" && direction !== "previous")
      throw new RangeError("Invalid transition direction");
    const next = timeZoneTransitionMilliseconds(epoch, this.#zone, direction === "next");
    return next === null ? null : new ZonedDateTime(BigInt(next) * NS_PER_MILLISECOND, this.#zone);
  }
  toInstant(): Instant {
    return new Instant(this.#epoch);
  }
  toPlainDate(): PlainDate {
    return createPlainDate(this.#day);
  }
  toPlainTime(): PlainTime {
    return createPlainTime(this.#time);
  }
  toPlainDateTime(): PlainDateTime {
    return createPlainDateTime(this.#day, this.#time);
  }
}
