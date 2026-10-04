import { parseMonthCode } from "./month-code.ts";
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
import { calendarName, calendarAnnotation } from "./calendar-id.ts";
import { ISOParser } from "./iso-parser.ts";
import { positiveDateField } from "./iso-fields.ts";
import { resolveDateFields } from "./date-fields.ts";
import { regulateISODate, dateUnitIndex, checkDateDay } from "./iso-date.ts";
import { addDate, calendarMonthStart } from "./calendar-date.ts";
import { CalendarContext } from "./calendar-context.ts";
import { resolveCalendar } from "./calendar-environment.ts";
import type { CalendarEnvironment } from "./calendar-environment.ts";
import { calendarEra, calendarEraYear, calendarSupportsEra } from "./calendar-eras.ts";
import { differenceDate } from "./date-duration.ts";
import { roundDateTimeDifference } from "./date-time-duration.ts";
import {
  integerWithTruncation,
  overflowOption,
  requireOptions,
  roundingIncrement,
  roundingMode,
  requiredString,
} from "./options.ts";
import { Duration, toDuration } from "./duration.ts";
import { createPlainDate } from "./plain-date.ts";
import type { PlainDate } from "./plain-date.ts";
import { PlainTime } from "./plain-time.ts";
import { resolveCalendarLike, isPlainCalendar, calendarContextFor } from "./plain-calendar.ts";

function checkYearMonth(year: number, month: number): void {
  if (
    year < -271821 ||
    year > 275760 ||
    (year === -271821 && month < 4) ||
    (year === 275760 && month > 9)
  )
    throw new RangeError("Year-month outside supported range");
}
export function createPlainYearMonth(
  day: number,
  calendar: CalendarContext | undefined = undefined,
): PlainYearMonth {
  return new PlainYearMonth(
    yearFromDays(day),
    monthFromTime(day * MS_PER_DAY) + 1,
    calendar,
    dateFromTime(day * MS_PER_DAY),
  );
}
function fromFields(
  value: Readonly<Temporal.PartialTemporalLike<Temporal.YearMonthLikeObject>>,
  options?: Readonly<Temporal.OverflowOptions>,
  calendar: CalendarContext | undefined = undefined,
  previous?: number,
): PlainYearMonth {
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
  const code = rawCode === undefined ? undefined : parseMonthCode(rawCode);
  const rawYear = value.year;
  const year = rawYear === undefined ? undefined : integerWithTruncation(rawYear);
  if (
    previous !== undefined &&
    era === undefined &&
    eraYear === undefined &&
    rawMonth === undefined &&
    rawCode === undefined &&
    rawYear === undefined
  )
    throw new TypeError("At least one year-month field is required");
  return createPlainYearMonth(
    resolveDateFields(
      year,
      month,
      code,
      1,
      era,
      eraYear,
      overflowOption(options),
      calendar,
      previous,
    ),
    calendar,
  );
}
function yearMonthString(
  day: number,
  calendar: CalendarContext | undefined,
  options?: Readonly<Temporal.PlainDateToStringOptions>,
): string {
  const show = calendarName(options);
  return (
    isoYear(yearFromDays(day)) +
    "-" +
    pad(monthFromTime(day * MS_PER_DAY) + 1, 2) +
    (calendar !== undefined || show === "always" || show === "critical"
      ? "-" + pad(dateFromTime(day * MS_PER_DAY), 2)
      : "") +
    calendarAnnotation(calendar?.identifier ?? "iso8601", show)
  );
}

export class PlainYearMonth {
  readonly #day: number;
  readonly #calendar: CalendarContext | undefined;
  constructor(
    isoYear: number,
    isoMonth: number,
    calendar: string | CalendarContext = "iso8601",
    referenceISODay = 1,
    environment: CalendarEnvironment | undefined = undefined,
  ) {
    const year = integerWithTruncation(isoYear);
    const month = integerWithTruncation(isoMonth);
    if (typeof calendar !== "string" && !(calendar instanceof CalendarContext))
      throw new TypeError("Calendar must be a string");
    this.#calendar =
      typeof calendar === "string" ? resolveCalendar(calendar, environment) : calendar;
    const day = integerWithTruncation(referenceISODay);
    const epochDay = regulateISODate(year, month, day, "reject");
    checkYearMonth(year, month);
    this.#day = epochDay;
  }
  static epochDay(value: PlainYearMonth): number {
    return value.#day;
  }
  static calendarContext(value: PlainYearMonth): CalendarContext | undefined {
    return value.#calendar;
  }
  static from(
    value: Temporal.PlainYearMonthLike,
    options: Readonly<Temporal.OverflowOptions> | undefined = undefined,
    environment: CalendarEnvironment | undefined = undefined,
  ): PlainYearMonth {
    if (value instanceof PlainYearMonth) {
      overflowOption(options);
      return createPlainYearMonth(value.#day, value.#calendar);
    }
    if (typeof value === "string") {
      const parsed = new ISOParser(value, false, true, true);
      if (!parsed.hasYear || parsed.utcDesignator)
        throw new RangeError("Invalid year-month string");
      const calendar = resolveCalendar(parsed.calendar, environment);
      if (!parsed.hasDay && calendar !== undefined)
        throw new RangeError("Non-ISO year-month strings require a reference day");
      overflowOption(options);
      const result = new PlainYearMonth(parsed.year, parsed.month, calendar, parsed.day);
      return createPlainYearMonth(calendarMonthStart(result.#day, calendar), calendar);
    }
    if (value === null || typeof value !== "object")
      throw new TypeError("Year-month requires an object or string");
    const fields: Readonly<Temporal.YearMonthLikeObject> = value;
    const rawCalendar = isPlainCalendar(value) ? undefined : fields.calendar;
    const calendar = isPlainCalendar(value)
      ? calendarContextFor(value)
      : rawCalendar === undefined
        ? undefined
        : resolveCalendarLike(rawCalendar, environment);
    return fromFields(fields, options, calendar);
  }
  static compare(
    one: Temporal.PlainYearMonthLike,
    two: Temporal.PlainYearMonthLike,
    environment: CalendarEnvironment | undefined = undefined,
  ): number {
    const a = PlainYearMonth.from(one, undefined, environment).#day;
    const b = PlainYearMonth.from(two, undefined, environment).#day;
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
    return fromFields(value, options, this.#calendar, day);
  }
  private addDuration(
    value: Temporal.DurationLike,
    options: Readonly<Temporal.OverflowOptions> | undefined,
    sign: number,
  ): PlainYearMonth {
    const day = this.#day;
    const duration = toDuration(value);
    const overflow = overflowOption(options);
    if (duration.weeks !== 0 || duration.days !== 0 || Duration.timeNanoseconds(duration) !== 0n)
      throw new RangeError("Year-month arithmetic only accepts years and months");
    const calendar = this.#calendar;
    const start = checkDateDay(calendarMonthStart(day, calendar));
    const result = addDate(
      start,
      duration.years * sign,
      duration.months * sign,
      0,
      0,
      overflow,
      calendar,
    );
    return createPlainYearMonth(calendarMonthStart(result, calendar), calendar);
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
    environment: CalendarEnvironment | undefined,
  ): Duration {
    const day = this.#day;
    const converted = PlainYearMonth.from(other, undefined, environment);
    const target = converted.#day;
    if (
      (this.#calendar?.identifier ?? "iso8601") !== (converted.#calendar?.identifier ?? "iso8601")
    )
      throw new RangeError("Year-month difference requires matching calendars");
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
    const start = checkDateDay(calendarMonthStart(day, this.#calendar));
    const end = checkDateDay(calendarMonthStart(target, this.#calendar));
    if (smallest === 1 && increment === 1) {
      const result = differenceDate(start, end, largest, this.#calendar);
      return since ? result.negated() : result;
    }
    const result = roundDateTimeDifference(
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
      this.#calendar,
    );
    return since ? result.negated() : result;
  }
  until(
    other: Temporal.PlainYearMonthLike,
    options:
      | Readonly<Temporal.RoundingOptionsWithLargestUnit<"year" | "month">>
      | undefined = undefined,
    environment: CalendarEnvironment | undefined = undefined,
  ): Duration {
    return this.difference(other, options, false, environment);
  }
  since(
    other: Temporal.PlainYearMonthLike,
    options:
      | Readonly<Temporal.RoundingOptionsWithLargestUnit<"year" | "month">>
      | undefined = undefined,
    environment: CalendarEnvironment | undefined = undefined,
  ): Duration {
    return this.difference(other, options, true, environment);
  }
  equals(
    other: Temporal.PlainYearMonthLike,
    environment: CalendarEnvironment | undefined = undefined,
  ): boolean {
    const day = this.#day;
    const converted = PlainYearMonth.from(other, undefined, environment);
    return (
      day === converted.#day &&
      (this.#calendar?.identifier ?? "iso8601") === (converted.#calendar?.identifier ?? "iso8601")
    );
  }
  toPlainDate(item: Temporal.PlainYearMonthToPlainDateOptions): PlainDate {
    const epochDay = this.#day;
    if (item === null || typeof item !== "object")
      throw new TypeError("Date fields must be an object");
    const rawDay = item.day;
    if (rawDay === undefined) throw new TypeError("Day required");
    const day = positiveDateField(rawDay);
    if (this.#calendar !== undefined) {
      const year = this.#calendar.yearAt(epochDay);
      return createPlainDate(year.date(year.monthAt(epochDay), day, "constrain"), this.#calendar);
    }
    const year = yearFromDays(epochDay);
    const month = monthFromTime(epochDay * MS_PER_DAY);
    return createPlainDate(epochDays(year, month, Math.min(day, daysInMonth(year, month))));
  }
  toString(options: Readonly<Temporal.PlainDateToStringOptions> | undefined = undefined): string {
    return yearMonthString(this.#day, this.#calendar, options);
  }
  toLocaleString(
    locales: Intl.LocalesArgument = undefined,
    options: Readonly<Intl.DateTimeFormatOptions> | undefined = undefined,
    source: TimeLocaleSource | undefined = undefined,
  ): string {
    this.#day;
    if (source === undefined) return yearMonthString(this.#day, this.#calendar);
    return source.formatDateTime(
      4,
      this.#day * MS_PER_DAY + MS_PER_DAY / 2,
      this.#calendar?.identifier ?? "iso8601",
      locales,
      options,
      undefined,
    );
  }
  toJSON(): string {
    return yearMonthString(this.#day, this.#calendar);
  }
  valueOf(): never {
    throw new TypeError("Temporal.PlainYearMonth cannot be converted to a primitive value");
  }
}
