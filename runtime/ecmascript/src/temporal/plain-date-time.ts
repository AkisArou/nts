import { parseMonthCode } from "./month-code.ts";
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
import { resolveCalendarLike, isPlainCalendar } from "./plain-calendar.ts";
import { Duration, toDuration, unitNanoseconds } from "./duration.ts";
import { NS_PER_DAY, floorDivide, roundNanoseconds } from "./exact.ts";
import { calendarName, calendarAnnotation } from "./calendar-id.ts";
import { CalendarContext } from "./calendar-context.ts";
import { resolveCalendar } from "./calendar-environment.ts";
import type { CalendarEnvironment } from "./calendar-environment.ts";
import { calendarEra, calendarEraYear, calendarSupportsEra } from "./calendar-eras.ts";
import { resolveDateFields } from "./date-fields.ts";
import { balanceDate } from "./calendar-date.ts";
import { formatISODate, isoWeek, isoWeekYear, regulateISODate } from "./iso-date.ts";
import { positiveDateField, regulateTimeField } from "./iso-fields.ts";
import { formatPlainTime, timeNanoseconds } from "./iso-time.ts";
import { checkDateTime, dateTimeUnitIndex, roundDateTimeDifference } from "./date-time-duration.ts";
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
  requiredString,
} from "./options.ts";

export function createPlainDateTime(
  day: number,
  time: number,
  calendar: CalendarContext | undefined = undefined,
): PlainDateTime {
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
    calendar,
  );
}

function fromFields(
  value: Readonly<Temporal.PartialTemporalLike<Temporal.DateTimeLikeObject>>,
  options: Readonly<Temporal.OverflowOptions> | undefined,
  previousDay?: number,
  previousTime = 0,
  calendar: CalendarContext | undefined = undefined,
): PlainDateTime {
  // Prepare fields in alphabetical order, converting each before the next
  // getter. Keep the nine prepared numeric values in scalar locals.
  const rawDay = value.day;
  const day = rawDay === undefined ? undefined : positiveDateField(rawDay);
  let era: string | undefined;
  let eraYear: number | undefined;
  if (calendar !== undefined && calendarSupportsEra(calendar.identifier)) {
    const rawEra = value.era;
    era = rawEra === undefined ? undefined : requiredString(rawEra);
    const rawEraYear = value.eraYear;
    eraYear = rawEraYear === undefined ? undefined : integerWithTruncation(rawEraYear);
  }
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
  const code = rawCode === undefined ? undefined : parseMonthCode(rawCode);
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
    era === undefined &&
    eraYear === undefined &&
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
  const resultDay = resolveDateFields(
    year,
    month,
    code,
    day,
    era,
    eraYear,
    overflow,
    calendar,
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
  return createPlainDateTime(resultDay, time, calendar);
}

function dateTimeString(
  day: number,
  time: number,
  calendar: CalendarContext | undefined,
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
    calendarAnnotation(calendar?.identifier ?? "iso8601", show)
  );
}

// Both slots are exact binary64 integers. Getters and ordinary formatting do
// not construct intermediate dates, times, arrays or field records.
export class PlainDateTime {
  readonly #day: number;
  readonly #time: number;
  readonly #calendar: CalendarContext | undefined;
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
    calendar: string | CalendarContext = "iso8601",
    environment: CalendarEnvironment | undefined = undefined,
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
    if (typeof calendar !== "string" && !(calendar instanceof CalendarContext))
      throw new TypeError("Calendar must be a string");
    this.#calendar =
      typeof calendar === "string" ? resolveCalendar(calendar, environment) : calendar;
    const date = regulateISODate(year, month, day, "reject");
    const time = timeNanoseconds(h, m, s, ms, us, ns);
    checkDateTime(date, time);
    this.#day = date;
    this.#time = time;
  }
  static epochDay(value: PlainDateTime): number {
    return value.#day;
  }
  static calendarContext(value: PlainDateTime): CalendarContext | undefined {
    return value.#calendar;
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
    environment: CalendarEnvironment | undefined = undefined,
  ): PlainDateTime {
    if (value instanceof ZonedDateTime) {
      const day = ZonedDateTime.epochDay(value);
      const time = ZonedDateTime.nanoseconds(value);
      overflowOption(options);
      return createPlainDateTime(day, time, ZonedDateTime.calendarContext(value));
    }
    if (value instanceof PlainDateTime) {
      overflowOption(options);
      return createPlainDateTime(value.#day, value.#time, value.#calendar);
    }
    if (value instanceof PlainDate) {
      overflowOption(options);
      return createPlainDateTime(PlainDate.epochDay(value), 0, PlainDate.calendarContext(value));
    }
    if (typeof value === "string") {
      const parsed = new ISOParser(value, false, true);
      if (parsed.utcDesignator)
        throw new RangeError("Plain date-time strings reject UTC designators");
      const calendar = resolveCalendar(parsed.calendar, environment);
      overflowOption(options);
      return createPlainDateTime(
        regulateISODate(parsed.year, parsed.month, parsed.day, "reject"),
        parsed.timeNanoseconds(),
        calendar,
      );
    }
    if (value === null || typeof value !== "object")
      throw new TypeError("Date-time requires an object or string");
    const fields: Readonly<Temporal.DateTimeLikeObject> = value;
    const rawCalendar = fields.calendar;
    const calendar =
      rawCalendar === undefined ? undefined : resolveCalendarLike(rawCalendar, environment);
    return fromFields(fields, options, undefined, 0, calendar);
  }
  static compare(
    one: Temporal.PlainDateTimeLike,
    two: Temporal.PlainDateTimeLike,
    environment: CalendarEnvironment | undefined = undefined,
  ): number {
    const a = PlainDateTime.from(one, undefined, environment);
    const b = PlainDateTime.from(two, undefined, environment);
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
    return fromFields(value, options, day, time, this.#calendar);
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
    return new ZonedDateTime(
      resolveLocalDateTime(day, time, zone, disambiguation),
      zone,
      this.#calendar,
    );
  }
  withPlainTime(value: Temporal.PlainTimeLike | undefined = undefined): PlainDateTime {
    const day = this.#day;
    const time = value === undefined ? 0 : PlainTime.nanoseconds(PlainTime.from(value));
    return createPlainDateTime(day, time, this.#calendar);
  }
  withCalendar(
    calendar: Temporal.CalendarLike,
    environment: CalendarEnvironment | undefined = undefined,
  ): PlainDateTime {
    const day = this.#day;
    const time = this.#time;
    return createPlainDateTime(day, time, resolveCalendarLike(calendar, environment));
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
      balanceDate(
        day,
        duration.years * sign,
        duration.months * sign,
        duration.weeks * sign,
        Number(days),
        overflow,
        this.#calendar,
      ),
      Number(sum - days * NS_PER_DAY),
      this.#calendar,
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
    environment: CalendarEnvironment | undefined,
  ): Duration {
    const day = this.#day;
    const time = this.#time;
    const target = PlainDateTime.from(other, undefined, environment);
    if ((this.#calendar?.identifier ?? "iso8601") !== (target.#calendar?.identifier ?? "iso8601"))
      throw new RangeError("Date-time difference requires matching calendars");
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
    const result = roundDateTimeDifference(
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
      this.#calendar,
    );
    return since ? result.negated() : result;
  }
  until(
    other: Temporal.PlainDateTimeLike,
    options:
      | Readonly<Temporal.RoundingOptionsWithLargestUnit<Temporal.DateUnit | Temporal.TimeUnit>>
      | undefined = undefined,
    environment: CalendarEnvironment | undefined = undefined,
  ): Duration {
    return this.difference(other, options, false, environment);
  }
  since(
    other: Temporal.PlainDateTimeLike,
    options:
      | Readonly<Temporal.RoundingOptionsWithLargestUnit<Temporal.DateUnit | Temporal.TimeUnit>>
      | undefined = undefined,
    environment: CalendarEnvironment | undefined = undefined,
  ): Duration {
    return this.difference(other, options, true, environment);
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
    return createPlainDateTime(
      day + Number(rounded / NS_PER_DAY),
      Number(rounded % NS_PER_DAY),
      this.#calendar,
    );
  }
  equals(
    other: Temporal.PlainDateTimeLike,
    environment: CalendarEnvironment | undefined = undefined,
  ): boolean {
    const day = this.#day;
    const time = this.#time;
    const target = PlainDateTime.from(other, undefined, environment);
    return (
      day === target.#day &&
      time === target.#time &&
      (this.#calendar?.identifier ?? "iso8601") === (target.#calendar?.identifier ?? "iso8601")
    );
  }
  toPlainDate(): PlainDate {
    const day = this.#day;
    const time = day * MS_PER_DAY;
    return new PlainDate(
      yearFromDays(day),
      monthFromTime(time) + 1,
      dateFromTime(time),
      this.#calendar,
    );
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
    return dateTimeString(this.#day, this.#time, this.#calendar, options);
  }
  toLocaleString(
    locales: Intl.LocalesArgument = undefined,
    options: Readonly<Intl.DateTimeFormatOptions> | undefined = undefined,
    source: TimeLocaleSource | undefined = undefined,
  ): string {
    this.#day;
    if (source === undefined) return dateTimeString(this.#day, this.#time, this.#calendar);
    return source.formatDateTime(
      3,
      this.#day * MS_PER_DAY + Math.floor(this.#time / 1e6),
      this.#calendar?.identifier ?? "iso8601",
      locales,
      options,
      undefined,
    );
  }
  toJSON(): string {
    return dateTimeString(this.#day, this.#time, this.#calendar);
  }
  valueOf(): never {
    throw new TypeError("Temporal.PlainDateTime cannot be converted to a primitive value");
  }
}
