import { PlainDate } from "./plain-date.ts";
import { PlainDateTime } from "./plain-date-time.ts";
import { ZonedDateTime } from "./zoned-date-time.ts";
import type { ResolvedTimeZone, TimeZoneSource } from "../time/zone-data.ts";
import { fromDateTimeFields } from "./date-time-fields.ts";
import { ISOParser } from "./iso-parser.ts";
import { checkDateDay } from "./iso-date.ts";
import { addDate } from "./calendar-date.ts";
import type { CalendarContext } from "./calendar-context.ts";
import type { CalendarEnvironment } from "./calendar-environment.ts";
import { differenceDate } from "./date-duration.ts";
import { floorDivide, NS_PER_DAY, checkTimeDuration, divideExact } from "./exact.ts";

export function relativeDate(
  value: Temporal.DurationRelativeToOptions["relativeTo"],
  source: TimeZoneSource | undefined,
  environment: CalendarEnvironment | undefined = undefined,
): PlainDate | ZonedDateTime<ResolvedTimeZone> | undefined {
  if (value === undefined) return undefined;
  if (value instanceof ZonedDateTime) {
    ZonedDateTime.epochNanoseconds(value);
    return value;
  }
  if (value instanceof PlainDate) {
    PlainDate.epochDay(value);
    return value;
  }
  if (value instanceof PlainDateTime) return PlainDate.from(value);
  if (typeof value === "string") {
    const parsed = new ISOParser(value, false, true);
    if (parsed.timeZone !== undefined)
      return ZonedDateTime.fromParsed(parsed, undefined, source, environment);
    if (parsed.utcDesignator) throw new RangeError("Plain relative dates reject UTC designators");
    return new PlainDate(parsed.year, parsed.month, parsed.day, parsed.calendar, environment);
  }
  if (value === null || (typeof value !== "object" && typeof value !== "function"))
    throw new TypeError("relativeTo requires a Temporal date, fields or string");
  return fromDateTimeFields(value, undefined, source, false, environment);
}

export function relativeDuration(
  day: number,
  years: number,
  months: number,
  weeks: number,
  time: bigint,
  calendar: CalendarContext | undefined = undefined,
): bigint {
  const calendarEnd = addDate(day, years, months, weeks, 0, "constrain", calendar);
  return checkTimeDuration(BigInt(calendarEnd - day) * NS_PER_DAY + time);
}

// Calendar fractions depend on the adjacent actual date. Round their exact
// rational quotient once, rather than adding separately rounded components.
export function relativeCalendarTotal(
  day: number,
  nanoseconds: bigint,
  unit: number,
  calendar: CalendarContext | undefined = undefined,
): number {
  if (nanoseconds === 0n) return 0;
  const origin = BigInt(day) * NS_PER_DAY;
  const end = origin + nanoseconds;
  const targetDay = checkDateDay(Number(floorDivide(end, NS_PER_DAY)));
  const difference = differenceDate(day, targetDay, unit, calendar);
  let whole = unit === 0 ? difference.years : unit === 1 ? difference.months : difference.weeks;
  let base = addDate(
    day,
    unit === 0 ? whole : 0,
    unit === 1 ? whole : 0,
    unit === 2 ? whole : 0,
    0,
    "constrain",
    calendar,
  );
  const direction = nanoseconds < 0n ? -1 : 1;
  if (
    (direction > 0 && BigInt(base) * NS_PER_DAY > end) ||
    (direction < 0 && BigInt(base) * NS_PER_DAY < end)
  ) {
    whole -= direction;
    base = addDate(
      day,
      unit === 0 ? whole : 0,
      unit === 1 ? whole : 0,
      unit === 2 ? whole : 0,
      0,
      "constrain",
      calendar,
    );
  }
  let adjacent = addDate(
    day,
    unit === 0 ? whole + direction : 0,
    unit === 1 ? whole + direction : 0,
    unit === 2 ? whole + direction : 0,
    0,
    "constrain",
    calendar,
  );
  if (direction > 0 ? end > BigInt(adjacent) * NS_PER_DAY : end < BigInt(adjacent) * NS_PER_DAY) {
    whole += direction;
    base = adjacent;
    adjacent = addDate(
      day,
      unit === 0 ? whole + direction : 0,
      unit === 1 ? whole + direction : 0,
      unit === 2 ? whole + direction : 0,
      0,
      "constrain",
      calendar,
    );
  }
  const denominator = BigInt(Math.abs(adjacent - base)) * NS_PER_DAY;
  const numerator = BigInt(whole) * denominator + end - BigInt(base) * NS_PER_DAY;
  return divideExact(numerator, denominator);
}
