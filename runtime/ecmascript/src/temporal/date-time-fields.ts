import { parseMonthCode } from "./month-code.ts";
import type { ResolvedTimeZone, TimeZoneSource } from "../time/zone-data.ts";
import { positiveDateField, regulateTimeField } from "./iso-fields.ts";
import { resolveDateFields } from "./date-fields.ts";
import { calendarSupportsEra } from "./calendar-eras.ts";
import type { CalendarEnvironment } from "./calendar-environment.ts";
import {
  integerWithTruncation,
  requiredString,
  requireOptions,
  disambiguationOption,
  offsetOption,
  overflowOption,
} from "./options.ts";
import { resolveCalendarLike } from "./plain-calendar.ts";
import { ISOParser } from "./iso-parser.ts";
import { timeNanoseconds } from "./iso-time.ts";
import { checkDateTime } from "./iso-date.ts";
import { resolveTimeZone } from "./zone-like.ts";
import { resolveLocalDateTime } from "./zoned-time.ts";
import { ZonedDateTime } from "./zoned-date-time.ts";
import { PlainDate, createPlainDate } from "./plain-date.ts";

function numericField(value: number | undefined): number {
  return value === undefined ? 0 : integerWithTruncation(value);
}

export function fromDateTimeFields(
  fields: Readonly<Partial<Temporal.ZonedDateTimeLikeObject>>,
  options: Readonly<Temporal.ZonedDateTimeFromOptions> | undefined,
  source: TimeZoneSource | undefined,
  requireZone: true,
  environment?: CalendarEnvironment,
): ZonedDateTime<ResolvedTimeZone>;
export function fromDateTimeFields(
  fields: Readonly<Partial<Temporal.ZonedDateTimeLikeObject>>,
  options: Readonly<Temporal.ZonedDateTimeFromOptions> | undefined,
  source: TimeZoneSource | undefined,
  requireZone: false,
  environment?: CalendarEnvironment,
): PlainDate | ZonedDateTime<ResolvedTimeZone>;
export function fromDateTimeFields(
  fields: Readonly<Partial<Temporal.ZonedDateTimeLikeObject>>,
  options: Readonly<Temporal.ZonedDateTimeFromOptions> | undefined,
  source: TimeZoneSource | undefined,
  requireZone: boolean,
  environment: CalendarEnvironment | undefined = undefined,
): PlainDate | ZonedDateTime<ResolvedTimeZone> {
  const rawCalendar = fields.calendar;
  const calendar =
    rawCalendar === undefined ? undefined : resolveCalendarLike(rawCalendar, environment);
  // Both abstract operations prepare the same fields in alphabetical order.
  // Scalars survive through interpretation; no prepared record is allocated.
  const rawDay = fields.day;
  const day = rawDay === undefined ? undefined : positiveDateField(rawDay);
  let era: string | undefined;
  let eraYear: number | undefined;
  if (calendar !== undefined && calendarSupportsEra(calendar.identifier)) {
    const rawEra = fields.era;
    era = rawEra === undefined ? undefined : requiredString(rawEra);
    const rawEraYear = fields.eraYear;
    eraYear = rawEraYear === undefined ? undefined : integerWithTruncation(rawEraYear);
  }
  const hour = numericField(fields.hour);
  const microsecond = numericField(fields.microsecond);
  const millisecond = numericField(fields.millisecond);
  const minute = numericField(fields.minute);
  const rawMonth = fields.month;
  const month = rawMonth === undefined ? undefined : positiveDateField(rawMonth);
  const rawCode = fields.monthCode;
  const code = rawCode === undefined ? undefined : parseMonthCode(rawCode);
  const nanosecond = numericField(fields.nanosecond);
  const rawOffset = fields.offset;
  const offset =
    rawOffset === undefined ? undefined : ISOParser.parseUTCOffset(requiredString(rawOffset));
  const second = numericField(fields.second);
  const rawZone = fields.timeZone;
  if (rawZone === undefined && requireZone)
    throw new TypeError("A zoned date-time requires a timeZone");
  const zone = rawZone === undefined ? undefined : resolveTimeZone(rawZone, source);
  const rawYear = fields.year;
  const year = rawYear === undefined ? undefined : integerWithTruncation(rawYear);
  if (options !== undefined) requireOptions(options);
  const disambiguation = disambiguationOption(options?.disambiguation);
  const offsetChoice = offsetOption(options?.offset, "reject");
  const overflow = overflowOption(options);
  const resultDay = resolveDateFields(year, month, code, day, era, eraYear, overflow, calendar);
  const time = timeNanoseconds(
    regulateTimeField(hour, 23, overflow),
    regulateTimeField(minute, 59, overflow),
    regulateTimeField(second, 59, overflow),
    regulateTimeField(millisecond, 999, overflow),
    regulateTimeField(microsecond, 999, overflow),
    regulateTimeField(nanosecond, 999, overflow),
  );
  if (zone === undefined) return createPlainDate(resultDay, calendar);
  checkDateTime(resultDay, time);
  return new ZonedDateTime(
    resolveLocalDateTime(
      resultDay,
      time,
      zone,
      disambiguation,
      offset === undefined ? "ignore" : offsetChoice,
      offset === undefined ? 0n : offset,
    ),
    zone,
    calendar,
  );
}
