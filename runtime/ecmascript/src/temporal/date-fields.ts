import type { CalendarContext } from "./calendar-context.ts";
import { calendarSupportsEra, calendarYearForEra } from "./calendar-eras.ts";
import { parseMonthCode } from "./month-code.ts";
import { integerWithTruncation, overflowOption, requiredString } from "./options.ts";
import { positiveDateField, resolveISOFields } from "./iso-fields.ts";
import { checkDateDay } from "./iso-date.ts";

// Prepare fields in the specified observable order. Era fields are never read
// for ISO, Chinese or Korean dates. Year snapshots handle only numeric data;
// coercion and field-bag error ordering belong at this public boundary.
export function dateFieldsDay(
  value: Readonly<Temporal.PartialTemporalLike<Temporal.DateLikeObject>>,
  options: Readonly<Temporal.OverflowOptions> | undefined,
  calendar: CalendarContext | undefined = undefined,
  previous: number | undefined = undefined,
): number {
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
  const rawMonth = value.month;
  const month = rawMonth === undefined ? undefined : positiveDateField(rawMonth);
  const rawCode = value.monthCode;
  const code = rawCode === undefined ? undefined : parseMonthCode(rawCode);
  const rawYear = value.year;
  const year = rawYear === undefined ? undefined : integerWithTruncation(rawYear);
  if (
    previous !== undefined &&
    rawDay === undefined &&
    era === undefined &&
    eraYear === undefined &&
    rawMonth === undefined &&
    rawCode === undefined &&
    rawYear === undefined
  )
    throw new TypeError("At least one date field is required");
  const overflow = overflowOption(options);
  return checkDateDay(
    resolveDateFields(year, month, code, day, era, eraYear, overflow, calendar, previous),
  );
}

export function resolveDateFields(
  year: number | undefined,
  month: number | undefined,
  code: number | undefined,
  day: number | undefined,
  era: string | undefined,
  eraYear: number | undefined,
  overflow: NonNullable<Temporal.OverflowOptions["overflow"]>,
  calendar: CalendarContext | undefined,
  previous: number | undefined = undefined,
): number {
  if (calendar === undefined) return resolveISOFields(year, month, code, day, overflow, previous);
  if (previous !== undefined) {
    const oldYear = calendar.yearAt(previous);
    const oldMonth = oldYear.monthAt(previous);
    if (year === undefined && era === undefined && eraYear === undefined) year = oldYear.year;
    if (day === undefined) day = previous - oldYear.monthStart(oldMonth) + 1;
    if (month === undefined && code === undefined) code = oldYear.monthCodeNumber(oldMonth);
  }
  if (year === undefined && (era === undefined || eraYear === undefined))
    throw new TypeError("Date requires year or era and eraYear");
  if ((era === undefined) !== (eraYear === undefined))
    throw new TypeError("Era and eraYear must be provided together");
  if (day === undefined) throw new TypeError("Date requires day");
  if (month === undefined && code === undefined)
    throw new TypeError("Date requires month or monthCode");
  if (era !== undefined && eraYear !== undefined) {
    const arithmeticYear = calendarYearForEra(calendar.identifier, era, eraYear);
    if (year !== undefined && year !== arithmeticYear)
      throw new RangeError("Year and eraYear disagree");
    year = arithmeticYear;
  }
  const topology = calendar.yearFor(year!);
  return topology.date(topology.resolveMonth(month, code, overflow), day, overflow);
}
