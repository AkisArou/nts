import { PlainDate } from "./plain-date.ts";
import { ISOParser } from "./iso-parser.ts";
import { addISODate, checkDateDay, differenceISODate } from "./iso-date.ts";
import { floorDivide, NS_PER_DAY, checkTimeDuration, divideExact } from "./exact.ts";

export function relativePlainDate(
  value: Temporal.DurationRelativeToOptions["relativeTo"],
): PlainDate | undefined {
  if (value === undefined) return undefined;
  if (value instanceof PlainDate) return value;
  if (typeof value === "string") {
    const parsed = new ISOParser(value, false, true);
    if (parsed.timeZone !== undefined)
      throw new RangeError("Zoned relative durations require the zone adapter");
    if (parsed.utcDesignator) throw new RangeError("Plain relative dates reject UTC designators");
    return new PlainDate(parsed.year, parsed.month, parsed.day, parsed.calendar);
  }
  if (value === null || typeof value !== "object")
    throw new TypeError("relativeTo requires a Temporal date, fields or string");
  const fields: Readonly<
    Temporal.DateLikeObject & Partial<Pick<Temporal.ZonedDateTimeLikeObject, "timeZone">>
  > = value;
  if (fields.timeZone !== undefined)
    throw new RangeError("Zoned relative durations require the zone adapter");
  return PlainDate.from(value);
}

export function relativeISODuration(
  day: number,
  years: number,
  months: number,
  weeks: number,
  time: bigint,
): bigint {
  const calendarEnd = addISODate(day, years, months, weeks, 0, "constrain");
  return checkTimeDuration(BigInt(calendarEnd - day) * NS_PER_DAY + time);
}

// Calendar fractions depend on the adjacent actual date. Round their exact
// rational quotient once, rather than adding separately rounded components.
export function relativeISOCalendarTotal(day: number, nanoseconds: bigint, unit: number): number {
  if (nanoseconds === 0n) return 0;
  const origin = BigInt(day) * NS_PER_DAY;
  const end = origin + nanoseconds;
  const targetDay = checkDateDay(Number(floorDivide(end, NS_PER_DAY)));
  const difference = differenceISODate(day, targetDay, unit);
  let whole = unit === 0 ? difference.years : unit === 1 ? difference.months : difference.weeks;
  let base = addISODate(
    day,
    unit === 0 ? whole : 0,
    unit === 1 ? whole : 0,
    unit === 2 ? whole : 0,
    0,
    "constrain",
  );
  const direction = nanoseconds < 0n ? -1 : 1;
  if (
    (direction > 0 && BigInt(base) * NS_PER_DAY > end) ||
    (direction < 0 && BigInt(base) * NS_PER_DAY < end)
  ) {
    whole -= direction;
    base = addISODate(
      day,
      unit === 0 ? whole : 0,
      unit === 1 ? whole : 0,
      unit === 2 ? whole : 0,
      0,
      "constrain",
    );
  }
  const adjacent = addISODate(
    day,
    unit === 0 ? whole + direction : 0,
    unit === 1 ? whole + direction : 0,
    unit === 2 ? whole + direction : 0,
    0,
    "constrain",
  );
  const denominator = BigInt(Math.abs(adjacent - base)) * NS_PER_DAY;
  const numerator = BigInt(whole) * denominator + end - BigInt(base) * NS_PER_DAY;
  return divideExact(numerator, denominator);
}
