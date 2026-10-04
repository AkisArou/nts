import { parseMonthCode } from "./month-code.ts";
import type { ResolvedTimeZone, TimeZoneSource } from "../time/zone-data.ts";
import { positiveDateField, resolveISOFields, regulateTimeField } from "./iso-fields.ts";
import {
  integerWithTruncation,
  requiredString,
  requireOptions,
  disambiguationOption,
  offsetOption,
  overflowOption,
} from "./options.ts";
import { requireISOCalendarLike } from "./plain-calendar.ts";
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
): ZonedDateTime<ResolvedTimeZone>;
export function fromDateTimeFields(
  fields: Readonly<Partial<Temporal.ZonedDateTimeLikeObject>>,
  options: Readonly<Temporal.ZonedDateTimeFromOptions> | undefined,
  source: TimeZoneSource | undefined,
  requireZone: false,
): PlainDate | ZonedDateTime<ResolvedTimeZone>;
export function fromDateTimeFields(
  fields: Readonly<Partial<Temporal.ZonedDateTimeLikeObject>>,
  options: Readonly<Temporal.ZonedDateTimeFromOptions> | undefined,
  source: TimeZoneSource | undefined,
  requireZone: boolean,
): PlainDate | ZonedDateTime<ResolvedTimeZone> {
  const calendar = fields.calendar;
  if (calendar !== undefined) requireISOCalendarLike(calendar);
  // Both abstract operations prepare the same fields in alphabetical order.
  // Scalars survive through interpretation; no prepared record is allocated.
  const rawDay = fields.day;
  const day = rawDay === undefined ? undefined : positiveDateField(rawDay);
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
  const resultDay = resolveISOFields(year, month, code, day, overflow);
  const time = timeNanoseconds(
    regulateTimeField(hour, 23, overflow),
    regulateTimeField(minute, 59, overflow),
    regulateTimeField(second, 59, overflow),
    regulateTimeField(millisecond, 999, overflow),
    regulateTimeField(microsecond, 999, overflow),
    regulateTimeField(nanosecond, 999, overflow),
  );
  if (zone === undefined) return createPlainDate(resultDay);
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
  );
}
