import { parseMonthCode } from "./month-code.ts";
import type { TimeLocaleSource } from "../time/locale-source.ts";
import {
  yearFromDays,
  monthFromTime,
  dateFromTime,
  daysInMonth,
  epochDays,
  MS_PER_DAY,
} from "../date/calendar.ts";
import { formatISODate, checkDateDay, regulateISODate } from "./iso-date.ts";
import { pad } from "../date/format.ts";
import { calendarName, calendarAnnotation } from "./calendar-id.ts";
import { ISOParser } from "./iso-parser.ts";
import { positiveDateField, resolveISOFields } from "./iso-fields.ts";
import { integerWithTruncation, overflowOption, requiredString } from "./options.ts";
import { createPlainDate } from "./plain-date.ts";
import type { PlainDate } from "./plain-date.ts";
import { PlainTime } from "./plain-time.ts";
import { resolveCalendarLike, isPlainCalendar, calendarContextFor } from "./plain-calendar.ts";
import { CalendarContext } from "./calendar-context.ts";
import { resolveCalendar } from "./calendar-environment.ts";
import type { CalendarEnvironment } from "./calendar-environment.ts";
import { calendarSupportsEra, calendarYearForEra } from "./calendar-eras.ts";
import { monthDayReference } from "./month-day-reference.ts";

export function createPlainMonthDay(
  day: number,
  calendar: CalendarContext | undefined = undefined,
): PlainMonthDay {
  return new PlainMonthDay(
    monthFromTime(day * MS_PER_DAY) + 1,
    dateFromTime(day * MS_PER_DAY),
    calendar,
    yearFromDays(day),
  );
}

export function monthDayFromDate(
  day: number,
  calendar: CalendarContext | undefined,
): PlainMonthDay {
  if (calendar === undefined)
    return new PlainMonthDay(monthFromTime(day * MS_PER_DAY) + 1, dateFromTime(day * MS_PER_DAY));
  const year = calendar.yearAt(day);
  const month = year.monthAt(day);
  return createPlainMonthDay(
    monthDayReference(
      calendar,
      year.monthCodeNumber(month),
      day - year.monthStart(month) + 1,
      "constrain",
    ),
    calendar,
  );
}

function fromFields(
  value: Readonly<Temporal.PartialTemporalLike<Temporal.DateLikeObject>>,
  options?: Readonly<Temporal.OverflowOptions>,
  calendar: CalendarContext | undefined = undefined,
  previous?: number,
): PlainMonthDay {
  const rawDay = value.day;
  let day = rawDay === undefined ? undefined : positiveDateField(rawDay);
  let era: string | undefined;
  let eraYear: number | undefined;
  if (calendar !== undefined && calendarSupportsEra(calendar.identifier)) {
    const rawEra = value.era;
    era = rawEra === undefined ? undefined : requiredString(rawEra);
    const rawEraYear = value.eraYear;
    eraYear = rawEraYear === undefined ? undefined : integerWithTruncation(rawEraYear);
  }
  const rawMonth = value.month;
  const month = rawMonth === undefined ? undefined : positiveDateField(rawMonth);
  const rawCode = value.monthCode;
  let code = rawCode === undefined ? undefined : parseMonthCode(rawCode);
  const rawYear = value.year;
  let year = rawYear === undefined ? undefined : integerWithTruncation(rawYear);
  if (
    previous !== undefined &&
    rawDay === undefined &&
    era === undefined &&
    eraYear === undefined &&
    rawMonth === undefined &&
    rawCode === undefined &&
    rawYear === undefined
  )
    throw new TypeError("At least one month-day field is required");
  const overflow = overflowOption(options);
  if (calendar === undefined) {
    const result = resolveISOFields(year ?? 1972, month, code, day, overflow, previous);
    return new PlainMonthDay(
      monthFromTime(result * MS_PER_DAY) + 1,
      dateFromTime(result * MS_PER_DAY),
    );
  }
  if (previous !== undefined) {
    const oldYear = calendar.yearAt(previous);
    const oldMonth = oldYear.monthAt(previous);
    if (day === undefined) day = previous - oldYear.monthStart(oldMonth) + 1;
    if (month === undefined && code === undefined) code = oldYear.monthCodeNumber(oldMonth);
  }
  if (
    (code === undefined || month !== undefined) &&
    year === undefined &&
    (era === undefined || eraYear === undefined)
  )
    throw new TypeError("Ordinal months require year or era and eraYear");
  if ((era === undefined) !== (eraYear === undefined))
    throw new TypeError("Era and eraYear must be provided together");
  if (day === undefined) throw new TypeError("Month-day requires day");
  if (month === undefined && code === undefined)
    throw new TypeError("Month-day requires month or monthCode");
  if (era !== undefined && eraYear !== undefined) {
    const arithmeticYear = calendarYearForEra(calendar.identifier, era, eraYear);
    if (year !== undefined && year !== arithmeticYear)
      throw new RangeError("Year and eraYear disagree");
    year = arithmeticYear;
  }
  if (year !== undefined) {
    const topology = calendar.yearFor(year);
    if (topology.firstDay > 100000000 || topology.endDay <= -100000001)
      throw new RangeError("Calendar year outside supported date range");
    const ordinal = topology.resolveMonth(month, code, overflow);
    const result = topology.date(ordinal, day, overflow);
    code = topology.monthCodeNumber(ordinal);
    day = result - topology.monthStart(ordinal) + 1;
  }
  return createPlainMonthDay(monthDayReference(calendar, code!, day, overflow), calendar);
}
function monthDayString(
  day: number,
  calendar: CalendarContext | undefined,
  options?: Readonly<Temporal.PlainDateToStringOptions>,
): string {
  const show = calendarName(options);
  return (
    (calendar !== undefined || show === "always" || show === "critical"
      ? formatISODate(day)
      : pad(monthFromTime(day * MS_PER_DAY) + 1, 2) +
        "-" +
        pad(dateFromTime(day * MS_PER_DAY), 2)) +
    calendarAnnotation(calendar?.identifier ?? "iso8601", show)
  );
}

export class PlainMonthDay {
  readonly #day: number;
  readonly #calendar: CalendarContext | undefined;
  constructor(
    isoMonth: number,
    isoDay: number,
    calendar: string | CalendarContext = "iso8601",
    referenceISOYear = 1972,
    environment: CalendarEnvironment | undefined = undefined,
  ) {
    const month = integerWithTruncation(isoMonth);
    const day = integerWithTruncation(isoDay);
    if (typeof calendar !== "string" && !(calendar instanceof CalendarContext))
      throw new TypeError("Calendar must be a string");
    this.#calendar =
      typeof calendar === "string" ? resolveCalendar(calendar, environment) : calendar;
    const year = integerWithTruncation(referenceISOYear);
    this.#day = checkDateDay(regulateISODate(year, month, day, "reject"));
  }
  static epochDay(value: PlainMonthDay): number {
    return value.#day;
  }
  static calendarContext(value: PlainMonthDay): CalendarContext | undefined {
    return value.#calendar;
  }
  static from(
    value: Temporal.PlainMonthDayLike,
    options: Readonly<Temporal.OverflowOptions> | undefined = undefined,
    environment: CalendarEnvironment | undefined = undefined,
  ): PlainMonthDay {
    if (value instanceof PlainMonthDay) {
      overflowOption(options);
      return createPlainMonthDay(value.#day, value.#calendar);
    }
    if (typeof value === "string") {
      const parsed = new ISOParser(value, false, true, true);
      if (!parsed.hasDay || parsed.utcDesignator) throw new RangeError("Invalid month-day string");
      const calendar = resolveCalendar(parsed.calendar, environment);
      if (!parsed.hasYear && calendar !== undefined)
        throw new RangeError("Non-ISO month-day strings require a reference year");
      overflowOption(options);
      if (calendar === undefined) return new PlainMonthDay(parsed.month, parsed.day);
      const result = new PlainMonthDay(
        parsed.month,
        parsed.day,
        calendar,
        parsed.hasYear ? parsed.year : 1972,
      );
      return monthDayFromDate(result.#day, calendar);
    }
    if (value === null || typeof value !== "object")
      throw new TypeError("Month-day requires an object or string");
    const fields: Readonly<Temporal.DateLikeObject> = value;
    const rawCalendar = isPlainCalendar(value) ? undefined : fields.calendar;
    const calendar = isPlainCalendar(value)
      ? calendarContextFor(value)
      : rawCalendar === undefined
        ? undefined
        : resolveCalendarLike(rawCalendar, environment);
    return fromFields(fields, options, calendar);
  }
  get calendarId(): string {
    this.#day;
    return this.#calendar?.identifier ?? "iso8601";
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
      isPlainCalendar(value) ||
      value instanceof PlainTime ||
      fields.calendar !== undefined ||
      fields.timeZone !== undefined
    )
      throw new TypeError("with requires fields without a calendar or time zone");
    return fromFields(value, options, this.#calendar, day);
  }
  equals(
    other: Temporal.PlainMonthDayLike,
    environment: CalendarEnvironment | undefined = undefined,
  ): boolean {
    const day = this.#day;
    const converted = PlainMonthDay.from(other, undefined, environment);
    return (
      day === converted.#day &&
      (this.#calendar?.identifier ?? "iso8601") === (converted.#calendar?.identifier ?? "iso8601")
    );
  }
  toPlainDate(item: Temporal.PlainMonthDayToPlainDateOptions): PlainDate {
    const day = this.#day;
    if (item === null || typeof item !== "object")
      throw new TypeError("Date fields must be an object");
    let era: string | undefined;
    let eraYear: number | undefined;
    if (this.#calendar !== undefined && calendarSupportsEra(this.#calendar.identifier)) {
      const rawEra = item.era;
      era = rawEra === undefined ? undefined : requiredString(rawEra);
      const rawEraYear = item.eraYear;
      eraYear = rawEraYear === undefined ? undefined : integerWithTruncation(rawEraYear);
    }
    const rawYear = item.year;
    let year = rawYear === undefined ? undefined : integerWithTruncation(rawYear);
    if (year === undefined && (era === undefined || eraYear === undefined))
      throw new TypeError("Year required");
    if ((era === undefined) !== (eraYear === undefined))
      throw new TypeError("Era and eraYear must be provided together");
    if (this.#calendar !== undefined) {
      if (era !== undefined && eraYear !== undefined) {
        const arithmeticYear = calendarYearForEra(this.#calendar.identifier, era, eraYear);
        if (year !== undefined && year !== arithmeticYear)
          throw new RangeError("Year and eraYear disagree");
        year = arithmeticYear;
      }
      const oldYear = this.#calendar.yearAt(day);
      const oldMonth = oldYear.monthAt(day);
      const target = this.#calendar.yearFor(year!);
      return createPlainDate(
        target.date(
          target.resolveMonth(undefined, oldYear.monthCodeNumber(oldMonth), "constrain"),
          day - oldYear.monthStart(oldMonth) + 1,
          "constrain",
        ),
        this.#calendar,
      );
    }
    const month = monthFromTime(day * MS_PER_DAY);
    return createPlainDate(
      epochDays(year!, month, Math.min(dateFromTime(day * MS_PER_DAY), daysInMonth(year!, month))),
    );
  }
  toString(options: Readonly<Temporal.PlainDateToStringOptions> | undefined = undefined): string {
    return monthDayString(this.#day, this.#calendar, options);
  }
  toLocaleString(
    locales: Intl.LocalesArgument = undefined,
    options: Readonly<Intl.DateTimeFormatOptions> | undefined = undefined,
    source: TimeLocaleSource | undefined = undefined,
  ): string {
    this.#day;
    if (source === undefined) return monthDayString(this.#day, this.#calendar);
    return source.formatDateTime(
      5,
      this.#day * MS_PER_DAY + MS_PER_DAY / 2,
      this.#calendar?.identifier ?? "iso8601",
      locales,
      options,
      undefined,
    );
  }
  toJSON(): string {
    return monthDayString(this.#day, this.#calendar);
  }
  valueOf(): never {
    throw new TypeError("Temporal.PlainMonthDay cannot be converted to a primitive value");
  }
}
