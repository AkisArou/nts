import type { TimeLocaleSource } from "../time/locale-source.ts";
import {
  yearFromDays,
  monthFromTime,
  dateFromTime,
  daysInMonth,
  isLeapYear,
  epochDays,
  MS_PER_DAY,
} from "../date/calendar.ts";
import { isoYear, pad } from "../date/format.ts";
import { calendarName, isoCalendarAnnotation, requireISOCalendar } from "./calendar-id.ts";
import { ISOParser } from "./iso-parser.ts";
import { positiveDateField, isoMonthCode, resolveISOFields } from "./iso-fields.ts";
import { regulateISODate, dateUnitIndex, checkDateDay, addISODate } from "./iso-date.ts";
import { differenceISODate } from "./iso-date-duration.ts";
import { roundISODateTimeDifference } from "./iso-date-time.ts";
import {
  integerWithTruncation,
  overflowOption,
  requireOptions,
  roundingIncrement,
  roundingMode,
} from "./options.ts";
import { Duration, toDuration } from "./duration.ts";
import { PlainDate } from "./plain-date.ts";
import { PlainTime } from "./plain-time.ts";
import { requireISOCalendarLike, isPlainCalendar } from "./plain-calendar.ts";

function checkYearMonth(year: number, month: number): void {
  if (
    year < -271821 ||
    year > 275760 ||
    (year === -271821 && month < 4) ||
    (year === 275760 && month > 9)
  )
    throw new RangeError("Year-month outside supported range");
}
function fromDay(day: number): PlainYearMonth {
  return new PlainYearMonth(
    yearFromDays(day),
    monthFromTime(day * MS_PER_DAY) + 1,
    "iso8601",
    dateFromTime(day * MS_PER_DAY),
  );
}
function fromFields(
  value: Readonly<Temporal.PartialTemporalLike<Temporal.YearMonthLikeObject>>,
  options?: Readonly<Temporal.OverflowOptions>,
  previous?: number,
): PlainYearMonth {
  const rawMonth = value.month;
  const month = rawMonth === undefined ? undefined : positiveDateField(rawMonth);
  const rawCode = value.monthCode;
  const code = rawCode === undefined ? undefined : isoMonthCode(rawCode);
  const rawYear = value.year;
  const year = rawYear === undefined ? undefined : integerWithTruncation(rawYear);
  if (
    previous !== undefined &&
    rawMonth === undefined &&
    rawCode === undefined &&
    rawYear === undefined
  )
    throw new TypeError("At least one year-month field is required");
  return fromDay(resolveISOFields(year, month, code, 1, overflowOption(options), previous));
}
function yearMonthString(
  day: number,
  options?: Readonly<Temporal.PlainDateToStringOptions>,
): string {
  const show = calendarName(options);
  return (
    isoYear(yearFromDays(day)) +
    "-" +
    pad(monthFromTime(day * MS_PER_DAY) + 1, 2) +
    (show === "always" || show === "critical" ? "-" + pad(dateFromTime(day * MS_PER_DAY), 2) : "") +
    isoCalendarAnnotation(show)
  );
}

export class PlainYearMonth {
  readonly #day: number;
  constructor(isoYear: number, isoMonth: number, calendar = "iso8601", referenceISODay = 1) {
    const year = integerWithTruncation(isoYear);
    const month = integerWithTruncation(isoMonth);
    requireISOCalendar(calendar);
    const day = integerWithTruncation(referenceISODay);
    const epochDay = regulateISODate(year, month, day, "reject");
    checkYearMonth(year, month);
    this.#day = epochDay;
  }
  static epochDay(value: PlainYearMonth): number {
    return value.#day;
  }
  static from(
    value: Temporal.PlainYearMonthLike,
    options: Readonly<Temporal.OverflowOptions> | undefined = undefined,
  ): PlainYearMonth {
    if (value instanceof PlainYearMonth) {
      overflowOption(options);
      return fromDay(value.#day);
    }
    if (typeof value === "string") {
      const parsed = new ISOParser(value, false, true, true);
      if (!parsed.hasYear || parsed.utcDesignator)
        throw new RangeError("Invalid year-month string");
      requireISOCalendar(parsed.calendar);
      overflowOption(options);
      return new PlainYearMonth(parsed.year, parsed.month);
    }
    if (value === null || typeof value !== "object")
      throw new TypeError("Year-month requires an object or string");
    const fields: Readonly<Temporal.YearMonthLikeObject> = value;
    const calendar = fields.calendar;
    if (calendar !== undefined) requireISOCalendarLike(calendar);
    return fromFields(fields, options);
  }
  static compare(one: Temporal.PlainYearMonthLike, two: Temporal.PlainYearMonthLike): number {
    const a = PlainYearMonth.from(one).#day;
    const b = PlainYearMonth.from(two).#day;
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
    value: Readonly<Temporal.PartialTemporalLike<Temporal.YearMonthLikeObject>>,
    options: Readonly<Temporal.OverflowOptions> | undefined = undefined,
  ): PlainYearMonth {
    const day = this.#day;
    if (value === null || typeof value !== "object")
      throw new TypeError("Year-month fields must be an object");
    const fields: Readonly<
      Temporal.PartialTemporalLike<Temporal.YearMonthLikeObject> &
        Partial<Pick<Temporal.ZonedDateTimeLikeObject, "calendar" | "timeZone">>
    > = value;
    if (
      isPlainCalendar(value) ||
      value instanceof PlainTime ||
      fields.calendar !== undefined ||
      fields.timeZone !== undefined
    )
      throw new TypeError("with requires fields without a calendar or time zone");
    return fromFields(value, options, day);
  }
  private addDuration(
    value: Temporal.DurationLike,
    options: Readonly<Temporal.OverflowOptions> | undefined,
    sign: number,
  ): PlainYearMonth {
    const day = this.#day;
    const duration = toDuration(value);
    const overflow = overflowOption(options);
    if (duration.weeks !== 0 || Duration.timeNanoseconds(duration) !== 0n)
      throw new RangeError("Year-month arithmetic only accepts years and months");
    const start = checkDateDay(epochDays(yearFromDays(day), monthFromTime(day * MS_PER_DAY), 1));
    return fromDay(
      addISODate(start, duration.years * sign, duration.months * sign, 0, 0, overflow),
    );
  }
  add(
    value: Temporal.DurationLike,
    options: Readonly<Temporal.OverflowOptions> | undefined = undefined,
  ): PlainYearMonth {
    return this.addDuration(value, options, 1);
  }
  subtract(
    value: Temporal.DurationLike,
    options: Readonly<Temporal.OverflowOptions> | undefined = undefined,
  ): PlainYearMonth {
    return this.addDuration(value, options, -1);
  }
  private difference(
    other: Temporal.PlainYearMonthLike,
    options: Readonly<Temporal.RoundingOptionsWithLargestUnit<"year" | "month">> | undefined,
    since: boolean,
  ): Duration {
    const day = this.#day;
    const target = PlainYearMonth.from(other).#day;
    if (options !== undefined) requireOptions(options);
    const rawLargest = options?.largestUnit;
    if (typeof rawLargest === "symbol")
      throw new TypeError("Temporal string options reject Symbols");
    const largestText = rawLargest === undefined ? "auto" : String(rawLargest);
    const increment = roundingIncrement(options?.roundingIncrement);
    const mode = roundingMode(options?.roundingMode);
    const rawSmallest = options?.smallestUnit;
    const smallest = rawSmallest === undefined ? 1 : dateUnitIndex(rawSmallest);
    const largest = largestText === "auto" ? 0 : dateUnitIndex(largestText);
    if (smallest > 1 || largest > smallest)
      throw new RangeError("Invalid year-month difference units");
    if (day === target) return new Duration();
    const start = checkDateDay(epochDays(yearFromDays(day), monthFromTime(day * MS_PER_DAY), 1));
    const end = checkDateDay(
      epochDays(yearFromDays(target), monthFromTime(target * MS_PER_DAY), 1),
    );
    if (smallest === 1 && increment === 1) {
      const result = differenceISODate(start, end, largest);
      return since ? result.negated() : result;
    }
    const result = roundISODateTimeDifference(
      start,
      0,
      end,
      0,
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
    other: Temporal.PlainYearMonthLike,
    options:
      | Readonly<Temporal.RoundingOptionsWithLargestUnit<"year" | "month">>
      | undefined = undefined,
  ): Duration {
    return this.difference(other, options, false);
  }
  since(
    other: Temporal.PlainYearMonthLike,
    options:
      | Readonly<Temporal.RoundingOptionsWithLargestUnit<"year" | "month">>
      | undefined = undefined,
  ): Duration {
    return this.difference(other, options, true);
  }
  equals(other: Temporal.PlainYearMonthLike): boolean {
    const day = this.#day;
    return day === PlainYearMonth.from(other).#day;
  }
  toPlainDate(item: Temporal.PlainYearMonthToPlainDateOptions): PlainDate {
    const epochDay = this.#day;
    if (item === null || typeof item !== "object")
      throw new TypeError("Date fields must be an object");
    const rawDay = item.day;
    if (rawDay === undefined) throw new TypeError("Day required");
    const day = positiveDateField(rawDay);
    const year = yearFromDays(epochDay);
    const month = monthFromTime(epochDay * MS_PER_DAY);
    return new PlainDate(year, month + 1, Math.min(day, daysInMonth(year, month)));
  }
  toString(options: Readonly<Temporal.PlainDateToStringOptions> | undefined = undefined): string {
    return yearMonthString(this.#day, options);
  }
  toLocaleString(
    locales: Intl.LocalesArgument = undefined,
    options: Readonly<Intl.DateTimeFormatOptions> | undefined = undefined,
    source: TimeLocaleSource | undefined = undefined,
  ): string {
    this.#day;
    if (source === undefined) return yearMonthString(this.#day);
    return source.formatDateTime(
      4,
      this.#day * MS_PER_DAY + MS_PER_DAY / 2,
      "iso8601",
      locales,
      options,
      undefined,
    );
  }
  toJSON(): string {
    return yearMonthString(this.#day);
  }
  valueOf(): never {
    throw new TypeError("Temporal.PlainYearMonth cannot be converted to a primitive value");
  }
}
