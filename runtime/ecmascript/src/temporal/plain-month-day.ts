import {
  yearFromDays,
  monthFromTime,
  dateFromTime,
  daysInMonth,
  MS_PER_DAY,
} from "../date/calendar.ts";
import { formatISODate, checkDateDay, regulateISODate } from "./iso-date.ts";
import { pad } from "../date/format.ts";
import type { WithResult } from "../contract.ts";
import { calendarName, isoCalendarAnnotation, requireISOCalendar } from "./calendar-id.ts";
import { ISOParser } from "./iso-parser.ts";
import { positiveDateField, isoMonthCode, resolveISOFields } from "./iso-fields.ts";
import { integerWithTruncation, overflowOption } from "./options.ts";
import { PlainDate } from "./plain-date.ts";
import { PlainDateTime } from "./plain-date-time.ts";
import { PlainTime } from "./plain-time.ts";
import { PlainYearMonth } from "./plain-year-month.ts";
import { requireISOCalendarLike } from "./plain-calendar.ts";

function fromFields(
  value: Readonly<Temporal.PartialTemporalLike<Temporal.DateLikeObject>>,
  options?: Readonly<Temporal.OverflowOptions>,
  previous?: number,
): PlainMonthDay {
  const rawDay = value.day;
  const day = rawDay === undefined ? undefined : positiveDateField(rawDay);
  const rawMonth = value.month;
  const month = rawMonth === undefined ? undefined : positiveDateField(rawMonth);
  const rawCode = value.monthCode;
  const code = rawCode === undefined ? undefined : isoMonthCode(rawCode);
  const rawYear = value.year;
  const year = rawYear === undefined ? 1972 : integerWithTruncation(rawYear);
  if (
    previous !== undefined &&
    rawDay === undefined &&
    rawMonth === undefined &&
    rawCode === undefined &&
    rawYear === undefined
  )
    throw new TypeError("At least one month-day field is required");
  const result = resolveISOFields(year, month, code, day, overflowOption(options), previous);
  return new PlainMonthDay(
    monthFromTime(result * MS_PER_DAY) + 1,
    dateFromTime(result * MS_PER_DAY),
  );
}
function monthDayString(
  day: number,
  options?: Readonly<Temporal.PlainDateToStringOptions>,
): string {
  const show = calendarName(options);
  return (
    (show === "always" || show === "critical"
      ? formatISODate(day)
      : pad(monthFromTime(day * MS_PER_DAY) + 1, 2) +
        "-" +
        pad(dateFromTime(day * MS_PER_DAY), 2)) + isoCalendarAnnotation(show)
  );
}

export class PlainMonthDay implements WithResult<
  WithResult<
    Omit<Temporal.PlainMonthDay, "toLocaleString" | typeof Symbol.toStringTag>,
    Temporal.PlainMonthDay,
    PlainMonthDay
  >,
  Temporal.PlainDate,
  PlainDate
> {
  readonly #day: number;
  constructor(isoMonth: number, isoDay: number, calendar = "iso8601", referenceISOYear = 1972) {
    const month = integerWithTruncation(isoMonth);
    const day = integerWithTruncation(isoDay);
    requireISOCalendar(calendar);
    const year = integerWithTruncation(referenceISOYear);
    this.#day = checkDateDay(regulateISODate(year, month, day, "reject"));
  }
  static epochDay(value: PlainMonthDay): number {
    return value.#day;
  }
  static from(
    value: Temporal.PlainMonthDayLike,
    options: Readonly<Temporal.OverflowOptions> | undefined = undefined,
  ): PlainMonthDay {
    if (value instanceof PlainMonthDay) {
      overflowOption(options);
      return new PlainMonthDay(
        monthFromTime(value.#day * MS_PER_DAY) + 1,
        dateFromTime(value.#day * MS_PER_DAY),
        "iso8601",
        yearFromDays(value.#day),
      );
    }
    if (typeof value === "string") {
      const parsed = new ISOParser(value, false, true, true);
      if (!parsed.hasDay || parsed.utcDesignator) throw new RangeError("Invalid month-day string");
      requireISOCalendar(parsed.calendar);
      overflowOption(options);
      return new PlainMonthDay(parsed.month, parsed.day);
    }
    if (value === null || typeof value !== "object")
      throw new TypeError("Month-day requires an object or string");
    const fields: Readonly<Temporal.DateLikeObject> = value;
    const calendar = fields.calendar;
    if (calendar !== undefined) requireISOCalendarLike(calendar);
    return fromFields(fields, options);
  }
  get calendarId(): string {
    this.#day;
    return "iso8601";
  }
  get monthCode(): string {
    return "M" + pad(monthFromTime(this.#day * MS_PER_DAY) + 1, 2);
  }
  get day(): number {
    return dateFromTime(this.#day * MS_PER_DAY);
  }
  with(
    value: Readonly<Temporal.PartialTemporalLike<Temporal.DateLikeObject>>,
    options: Readonly<Temporal.OverflowOptions> | undefined = undefined,
  ): PlainMonthDay {
    const day = this.#day;
    if (value === null || typeof value !== "object")
      throw new TypeError("Month-day fields must be an object");
    const fields: Readonly<
      Temporal.PartialTemporalLike<Temporal.DateLikeObject> &
        Partial<Pick<Temporal.ZonedDateTimeLikeObject, "calendar" | "timeZone">>
    > = value;
    if (
      value instanceof PlainYearMonth ||
      value instanceof PlainDate ||
      value instanceof PlainDateTime ||
      value instanceof PlainTime ||
      value instanceof PlainMonthDay ||
      fields.calendar !== undefined ||
      fields.timeZone !== undefined
    )
      throw new TypeError("with requires fields without a calendar or time zone");
    return fromFields(value, options, day);
  }
  equals(other: Temporal.PlainMonthDayLike): boolean {
    const day = this.#day;
    return day === PlainMonthDay.from(other).#day;
  }
  toPlainDate(item: Temporal.PlainMonthDayToPlainDateOptions): PlainDate {
    const day = this.#day;
    if (item === null || typeof item !== "object")
      throw new TypeError("Date fields must be an object");
    const rawYear = item.year;
    if (rawYear === undefined) throw new TypeError("Year required");
    const year = integerWithTruncation(rawYear);
    const month = monthFromTime(day * MS_PER_DAY);
    return new PlainDate(
      year,
      month + 1,
      Math.min(dateFromTime(day * MS_PER_DAY), daysInMonth(year, month)),
    );
  }
  toString(options: Readonly<Temporal.PlainDateToStringOptions> | undefined = undefined): string {
    return monthDayString(this.#day, options);
  }
  toJSON(): string {
    return monthDayString(this.#day);
  }
  valueOf(): never {
    throw new TypeError("Temporal.PlainMonthDay cannot be converted to a primitive value");
  }
}
