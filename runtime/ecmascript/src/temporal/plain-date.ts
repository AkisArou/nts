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
  roundISODateDifference,
  isoWeek,
  isoWeekYear,
  formatISODate,
} from "./iso-date.ts";
import type { WithResult } from "../contract.ts";
import { positiveDateField, isoMonthCode, resolveISOFields } from "./iso-fields.ts";
import { requireISOCalendar, requireISOCalendarString, calendarName, isoCalendarAnnotation } from "./calendar-id.ts";
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

// Immutable ISO date stage. Calendar adapters and cross-type/localized methods
// extend this contract as they become executable; missing APIs stay visible.
export class PlainDate implements WithResult<
  WithResult<
    Omit<
      Temporal.PlainDate,
      | "toPlainYearMonth"
      | "toPlainMonthDay"
      | "toPlainDateTime"
      | "toZonedDateTime"
      | "toLocaleString"
      | typeof Symbol.toStringTag
    >,
    Temporal.PlainDate,
    PlainDate
  >,
  Temporal.Duration,
  Duration
> {
  readonly #day: number;
  constructor(isoYear: number, isoMonth: number, isoDay: number, calendar = "iso8601") {
    const year = integerWithTruncation(isoYear);
    const month = integerWithTruncation(isoMonth);
    const day = integerWithTruncation(isoDay);
    requireISOCalendar(calendar);
    this.#day = checkDateDay(regulateISODate(year, month, day, "reject"));
  }
  private static fromDay(day: number): PlainDate {
    const time = day * MS_PER_DAY;
    return new PlainDate(yearFromDays(day), monthFromTime(time) + 1, dateFromTime(time));
  }
  static epochDay(value: PlainDate): number {
    return value.#day;
  }
  static from(
    value: Temporal.PlainDateLike,
    options?: Readonly<Temporal.OverflowOptions>,
  ): PlainDate {
    if (value instanceof PlainDate) {
      overflowOption(options);
      return PlainDate.fromDay(value.#day);
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
    if (calendar !== undefined) requireISOCalendarString(calendar);
    return PlainDate.fromDay(fieldsDay(value, options));
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
    options?: Readonly<Temporal.OverflowOptions>,
  ): PlainDate {
    const previous = this.#day;
    if (value === null || typeof value !== "object")
      throw new TypeError("Date fields must be an object");
    const fields: Readonly<
      Temporal.PartialTemporalLike<Temporal.DateLikeObject> &
        Partial<Pick<Temporal.ZonedDateTimeLikeObject, "calendar" | "timeZone">>
    > = value;
    if (
      value instanceof PlainDate ||
      fields.calendar !== undefined ||
      fields.timeZone !== undefined
    )
      throw new TypeError("with requires date fields without a calendar or time zone");
    return PlainDate.fromDay(fieldsDay(value, options, previous));
  }
  withCalendar(calendar: Temporal.CalendarLike): PlainDate {
    const day = this.#day;
    if (calendar instanceof PlainDate) return PlainDate.fromDay(day);
    if (typeof calendar !== "string")
      throw new TypeError("Calendar requires a string or Temporal date");
    requireISOCalendarString(calendar);
    return PlainDate.fromDay(day);
  }
  private addDuration(
    value: Temporal.DurationLike,
    options: Readonly<Temporal.OverflowOptions> | undefined,
    sign: number,
  ): PlainDate {
    const day = this.#day;
    const duration = toDuration(value);
    const days = Number(duration.timeNanoseconds() / NS_PER_DAY);
    const overflow = overflowOption(options);
    return PlainDate.fromDay(
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
  add(value: Temporal.DurationLike, options?: Readonly<Temporal.OverflowOptions>): PlainDate {
    return this.addDuration(value, options, 1);
  }
  subtract(value: Temporal.DurationLike, options?: Readonly<Temporal.OverflowOptions>): PlainDate {
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
    options?: Readonly<Temporal.RoundingOptionsWithLargestUnit<Temporal.DateUnit>>,
  ): Duration {
    return this.difference(other, options, false);
  }
  since(
    other: Temporal.PlainDateLike,
    options?: Readonly<Temporal.RoundingOptionsWithLargestUnit<Temporal.DateUnit>>,
  ): Duration {
    return this.difference(other, options, true);
  }
  equals(other: Temporal.PlainDateLike): boolean {
    const day = this.#day;
    return day === PlainDate.from(other).#day;
  }
  toString(options?: Readonly<Temporal.PlainDateToStringOptions>): string {
    return dateString(this.#day, options);
  }
  toJSON(): string {
    return dateString(this.#day);
  }
  valueOf(): never {
    throw new TypeError("Temporal.PlainDate cannot be converted to a primitive value");
  }
}
