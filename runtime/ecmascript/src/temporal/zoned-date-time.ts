import { parseMonthCode } from "./month-code.ts";
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
import { calendarName, calendarAnnotation } from "./calendar-id.ts";
import { resolveCalendarLike, isPlainCalendar } from "./plain-calendar.ts";
import { CalendarContext } from "./calendar-context.ts";
import { resolveCalendar } from "./calendar-environment.ts";
import type { CalendarEnvironment } from "./calendar-environment.ts";
import { calendarEra, calendarEraYear, calendarSupportsEra } from "./calendar-eras.ts";
import { resolveDateFields } from "./date-fields.ts";
import { formatISODate, isoWeek, isoWeekYear, checkDateTime } from "./iso-date.ts";
import { positiveDateField, regulateTimeField } from "./iso-fields.ts";
import { formatPlainTime, timeNanoseconds } from "./iso-time.ts";
import { dateTimeUnitIndex } from "./date-time-duration.ts";
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
import { addZonedDateTime, roundZonedDateTime } from "./zoned-arithmetic.ts";
import { roundZonedDifference } from "./zoned-difference.ts";
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
// query ICU for ISO dates. Other calendars retain the same shared context and
// immutable year snapshots as plain dates; time-zone state remains independent.
export class ZonedDateTime<Z extends ResolvedTimeZone> {
  readonly #epoch: bigint;
  readonly #zone: Z;
  readonly #day: number;
  readonly #time: number;
  readonly #offset: number;
  readonly #calendar: CalendarContext | undefined;

  constructor(
    epochNanoseconds: bigint,
    zone: Z,
    calendar: string | CalendarContext = "iso8601",
    environment: CalendarEnvironment | undefined = undefined,
  ) {
    if (typeof epochNanoseconds !== "bigint")
      throw new TypeError("Epoch nanoseconds must be a BigInt");
    this.#epoch = checkInstant(epochNanoseconds);
    if (typeof calendar !== "string" && !(calendar instanceof CalendarContext))
      throw new TypeError("Calendar must be a string");
    this.#calendar =
      typeof calendar === "string" ? resolveCalendar(calendar, environment) : calendar;
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
  static calendarContext(value: ZonedDateTime<ResolvedTimeZone>): CalendarContext | undefined {
    return value.#calendar;
  }
  static rules<R extends ResolvedTimeZone>(value: ZonedDateTime<R>): R {
    return value.#zone;
  }

  static from(
    value: Temporal.ZonedDateTimeLike | ZonedDateTime<ResolvedTimeZone>,
    options: Readonly<Temporal.ZonedDateTimeFromOptions> | undefined = undefined,
    source: TimeZoneSource | undefined = undefined,
    environment: CalendarEnvironment | undefined = undefined,
  ): ZonedDateTime<ResolvedTimeZone> {
    if (value instanceof ZonedDateTime) {
      const epoch = value.#epoch;
      if (options !== undefined) requireOptions(options);
      disambiguationOption(options?.disambiguation);
      offsetOption(options?.offset, "reject");
      overflowOption(options);
      return new ZonedDateTime(epoch, value.#zone, value.#calendar);
    }
    if (typeof value === "string")
      return ZonedDateTime.fromParsed(
        new ISOParser(value, false, true),
        options,
        source,
        environment,
      );
    if (value === null || (typeof value !== "object" && typeof value !== "function"))
      throw new TypeError("Zoned date-time requires an object or string");
    return fromDateTimeFields(value, options, source, true, environment);
  }
  static fromParsed(
    parsed: ISOParser,
    options: Readonly<Temporal.ZonedDateTimeFromOptions> | undefined,
    source: TimeZoneSource | undefined,
    environment: CalendarEnvironment | undefined = undefined,
  ): ZonedDateTime<ResolvedTimeZone> {
    if (parsed.timeZone === undefined)
      throw new RangeError("Zoned date-time strings require a time-zone annotation");
    const zone = resolveTimeZoneIdentifier(parsed.timeZone, source);
    const calendar = resolveCalendar(parsed.calendar, environment);
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
    return new ZonedDateTime(epoch, zone, calendar);
  }
  static compare(
    one: Temporal.ZonedDateTimeLike | ZonedDateTime<ResolvedTimeZone>,
    two: Temporal.ZonedDateTimeLike | ZonedDateTime<ResolvedTimeZone>,
    source: TimeZoneSource | undefined = undefined,
    environment: CalendarEnvironment | undefined = undefined,
  ): number {
    const a = ZonedDateTime.from(one, undefined, source, environment).#epoch;
    const b = ZonedDateTime.from(two, undefined, source, environment).#epoch;
    return a < b ? -1 : a > b ? 1 : 0;
  }
  get calendarId(): string {
    this.#epoch;
    return this.#calendar?.identifier ?? "iso8601";
  }
  get timeZoneId(): string {
    return this.#zone.id;
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
    this.#epoch;
    return this.#calendar === undefined ? 12 : this.#calendar.yearAt(this.#day).monthsInYear;
  }
  get inLeapYear(): boolean {
    const day = this.#day;
    return this.#calendar === undefined
      ? isLeapYear(yearFromDays(day))
      : this.#calendar.yearAt(day).inLeapYear;
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
    let era: string | undefined;
    let eraYear: number | undefined;
    if (this.#calendar !== undefined && calendarSupportsEra(this.#calendar.identifier)) {
      const rawEra = fields.era;
      era = rawEra === undefined ? undefined : requiredString(rawEra);
      const rawEraYear = fields.eraYear;
      eraYear = rawEraYear === undefined ? undefined : integerWithTruncation(rawEraYear);
    }
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
    const code = rawCode === undefined ? undefined : parseMonthCode(rawCode);
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
      era === undefined &&
      eraYear === undefined &&
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
    const resultDay = resolveDateFields(
      year,
      month,
      code,
      day,
      era,
      eraYear,
      overflow,
      this.#calendar,
      previousDay,
    );
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
      this.#calendar,
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
    return new ZonedDateTime(epoch, this.#zone, this.#calendar);
  }
  withTimeZone(
    value: Temporal.TimeZoneLike | ZonedDateTime<ResolvedTimeZone>,
    source: TimeZoneSource | undefined = undefined,
  ): ZonedDateTime<ResolvedTimeZone> {
    const epoch = this.#epoch;
    return new ZonedDateTime(epoch, resolveTimeZone(value, source), this.#calendar);
  }
  withCalendar(
    value: Temporal.CalendarLike | ZonedDateTime<ResolvedTimeZone>,
    environment: CalendarEnvironment | undefined = undefined,
  ): ZonedDateTime<Z> {
    const epoch = this.#epoch;
    const calendar =
      value instanceof ZonedDateTime ? value.#calendar : resolveCalendarLike(value, environment);
    return new ZonedDateTime(epoch, this.#zone, calendar);
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
      addZonedDateTime(
        epoch,
        this.#zone,
        Duration.field(duration, 0) * sign,
        Duration.field(duration, 1) * sign,
        Duration.field(duration, 2) * sign,
        days * sign,
        (Duration.timeNanoseconds(duration) - BigInt(days) * NS_PER_DAY) * BigInt(sign),
        overflow,
        this.#calendar,
      ),
      this.#zone,
      this.#calendar,
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
    environment: CalendarEnvironment | undefined,
  ): Duration {
    const epoch = this.#epoch;
    const target =
      other instanceof ZonedDateTime
        ? other
        : ZonedDateTime.from(other, undefined, source, environment);
    const targetEpoch = target.#epoch;
    if ((this.#calendar?.identifier ?? "iso8601") !== (target.#calendar?.identifier ?? "iso8601"))
      throw new RangeError("Zoned date-time difference requires matching calendars");
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
    const result = roundZonedDifference(
      epoch,
      targetEpoch,
      this.#zone,
      largest,
      smallest,
      increment,
      since ? negateRoundingMode(mode) : mode,
      this.#calendar,
    );
    return since ? result.negated() : result;
  }
  until(
    other: Temporal.ZonedDateTimeLike | ZonedDateTime<ResolvedTimeZone>,
    options:
      | Readonly<Temporal.RoundingOptionsWithLargestUnit<Temporal.DateUnit | Temporal.TimeUnit>>
      | undefined = undefined,
    source: TimeZoneSource | undefined = undefined,
    environment: CalendarEnvironment | undefined = undefined,
  ): Duration {
    return this.#difference(other, options, false, source, environment);
  }
  since(
    other: Temporal.ZonedDateTimeLike | ZonedDateTime<ResolvedTimeZone>,
    options:
      | Readonly<Temporal.RoundingOptionsWithLargestUnit<Temporal.DateUnit | Temporal.TimeUnit>>
      | undefined = undefined,
    source: TimeZoneSource | undefined = undefined,
    environment: CalendarEnvironment | undefined = undefined,
  ): Duration {
    return this.#difference(other, options, true, source, environment);
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
      roundZonedDateTime(epoch, this.#zone, index, increment, mode),
      this.#zone,
      this.#calendar,
    );
  }
  equals(
    other: Temporal.ZonedDateTimeLike | ZonedDateTime<ResolvedTimeZone>,
    source: TimeZoneSource | undefined = undefined,
    environment: CalendarEnvironment | undefined = undefined,
  ): boolean {
    const epoch = this.#epoch;
    const target = ZonedDateTime.from(other, undefined, source, environment);
    return (
      epoch === target.#epoch &&
      this.#zone.primaryId === target.#zone.primaryId &&
      (this.#calendar?.identifier ?? "iso8601") === (target.#calendar?.identifier ?? "iso8601")
    );
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
      calendarAnnotation(this.#calendar?.identifier ?? "iso8601", calendar)
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
      this.#calendar?.identifier ?? "iso8601",
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
    return new ZonedDateTime(startOfDay(this.#day, this.#zone), this.#zone, this.#calendar);
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
    return next === null
      ? null
      : new ZonedDateTime(BigInt(next) * NS_PER_MILLISECOND, this.#zone, this.#calendar);
  }
  toInstant(): Instant {
    return new Instant(this.#epoch);
  }
  toPlainDate(): PlainDate {
    return createPlainDate(this.#day, this.#calendar);
  }
  toPlainTime(): PlainTime {
    return createPlainTime(this.#time);
  }
  toPlainDateTime(): PlainDateTime {
    return createPlainDateTime(this.#day, this.#time, this.#calendar);
  }
}
