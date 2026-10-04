import type { TimeZoneRules } from "../time/provider.ts";
import type { RoundingMode } from "./exact.ts";
import {
  checkInstant,
  floorDivide,
  NS_PER_DAY,
  roundNanoseconds,
  unitNanoseconds,
} from "./exact.ts";
import { checkDateTime } from "./iso-date.ts";
import { addDate } from "./calendar-date.ts";
import type { CalendarContext } from "./calendar-context.ts";
import {
  localNanoseconds,
  offsetNanoseconds,
  resolveLocalDateTime,
  startOfDay,
} from "./zoned-time.ts";

// Calendar date units advance wall dates; time units advance exact elapsed time.
// The caller supplies normalized fields, so no options, public property reads,
// Duration construction or calendar-object dependency belongs in this kernel.
export function addZonedDateTime(
  epoch: bigint,
  zone: TimeZoneRules,
  years: number,
  months: number,
  weeks: number,
  days: number,
  time: bigint,
  overflow: NonNullable<Temporal.OverflowOptions["overflow"]>,
  calendar: CalendarContext | undefined = undefined,
): bigint {
  checkInstant(epoch);
  if (years === 0 && months === 0 && weeks === 0 && days === 0) return checkInstant(epoch + time);
  const local = localNanoseconds(epoch, zone);
  const localDay = floorDivide(local, NS_PER_DAY);
  const localTime = Number(local - localDay * NS_PER_DAY);
  const addedDay = addDate(Number(localDay), years, months, weeks, days, overflow, calendar);
  checkDateTime(addedDay, localTime);
  return checkInstant(resolveLocalDateTime(addedDay, localTime, zone, "compatible") + time);
}

export function roundZonedDateTime(
  epoch: bigint,
  zone: TimeZoneRules,
  unit: number,
  increment: number,
  mode: RoundingMode,
): bigint {
  checkInstant(epoch);
  if (unit === 9 && increment === 1) return epoch;
  const offset = offsetNanoseconds(epoch, zone);
  const local = epoch + offset;
  const day = floorDivide(local, NS_PER_DAY);
  if (unit === 3) {
    if (increment !== 1) throw new RangeError("Day rounding requires an increment of one");
    const start = startOfDay(Number(day), zone);
    const end = startOfDay(Number(day) + 1, zone);
    if (end <= start || epoch < start)
      throw new Error("Time-zone provider returned inconsistent day boundaries");
    // A rollback across midnight can repeat part of today's date after the
    // first midnight of tomorrow. Day rounding still snaps to these two first
    // boundaries; cap progress as resolved in Temporal issue #3312/Test262.
    const progress = (epoch >= end ? end - 1n : epoch) - start;
    return checkInstant(start + roundNanoseconds(progress, end - start, mode));
  }
  const time = local - day * NS_PER_DAY;
  const rounded = roundNanoseconds(time, unitNanoseconds(unit) * BigInt(increment), mode);
  const dayShift = floorDivide(rounded, NS_PER_DAY);
  const resultDay = Number(day + dayShift);
  const resultTime = Number(rounded - dayShift * NS_PER_DAY);
  checkDateTime(resultDay, resultTime);
  // Prefer the original offset when rounding inside a fold. If rounding lands
  // in a gap, compatible disambiguation supplies the specified wall-time shift.
  return resolveLocalDateTime(resultDay, resultTime, zone, "compatible", "prefer", offset);
}
