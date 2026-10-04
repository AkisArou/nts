import type { TimeZoneRules } from "../time/provider.ts";
import type { RoundingMode } from "./exact.ts";
import { floorDivide, NS_PER_DAY, roundNanoseconds, unitNanoseconds } from "./exact.ts";
import { Duration, balanceDuration } from "./duration.ts";
import { differenceISODate } from "./iso-date-duration.ts";
import { addISODate } from "./iso-date.ts";
import { localNanoseconds, resolveLocalDateTime } from "./zoned-time.ts";

function elapsed(duration: Duration): bigint {
  return Duration.timeNanoseconds(duration) - BigInt(Duration.field(duration, 3)) * NS_PER_DAY;
}

// A zoned date remainder can exceed 24 hours. Preserve its elapsed hours
// separately from calendar days rather than balancing it through NS_PER_DAY.
function difference(
  start: bigint,
  end: bigint,
  zone: TimeZoneRules,
  startDay: number,
  startTime: number,
  largest: number,
): Duration {
  const localEnd = localNanoseconds(end, zone);
  const endDay = Number(floorDivide(localEnd, NS_PER_DAY));
  if (startDay === endDay) return balanceDuration(end - start, 4);
  const endTime = Number(localEnd - BigInt(endDay) * NS_PER_DAY);
  const sign = end > start ? 1 : -1;
  let correction = sign * (endTime - startTime) < 0 ? 1 : 0;
  const maximum = sign > 0 ? 2 : 1;
  while (correction <= maximum) {
    const intermediateDay = endDay - correction * sign;
    const intermediate = resolveLocalDateTime(intermediateDay, startTime, zone, "compatible");
    const remainder = end - intermediate;
    if (sign > 0 ? remainder >= 0n : remainder <= 0n) {
      const date = differenceISODate(startDay, intermediateDay, largest);
      return balanceDuration(
        remainder,
        4,
        Duration.field(date, 0),
        Duration.field(date, 1),
        Duration.field(date, 2),
        Duration.field(date, 3),
      );
    }
    correction++;
  }
  throw new Error("Time-zone provider returned inconsistent date boundaries");
}

function boundary(
  origin: bigint,
  day: number,
  time: number,
  zone: TimeZoneRules,
  years: number,
  months: number,
  weeks: number,
  days: number,
): bigint {
  if (years === 0 && months === 0 && weeks === 0 && days === 0) return origin;
  return resolveLocalDateTime(
    addISODate(day, years, months, weeks, days, "constrain"),
    time,
    zone,
    "compatible",
  );
}

function bubble(
  origin: bigint,
  day: number,
  time: number,
  zone: TimeZoneRules,
  raw: Duration,
  nudged: bigint,
  sign: number,
  largest: number,
  smallest: number,
): Duration {
  let result = raw;
  for (let unit = smallest - 1; unit >= largest; unit--) {
    if (unit === 2 && largest !== 2) continue;
    const years = Duration.field(result, 0) + (unit === 0 ? sign : 0);
    const months = unit === 0 ? 0 : Duration.field(result, 1) + (unit === 1 ? sign : 0);
    const weeks = unit === 2 ? Duration.field(result, 2) + sign : 0;
    const next = boundary(origin, day, time, zone, years, months, weeks, 0);
    if (sign > 0 ? nudged < next : nudged > next) break;
    result = new Duration(years, months, weeks);
  }
  return result;
}

// Exact distances between actual zoned boundaries select calendar rounding.
// Estimates and corrections are bounded even at the representable endpoints.
export function roundISOZonedDifference(
  start: bigint,
  end: bigint,
  zone: TimeZoneRules,
  largest: number,
  smallest: number,
  increment: number,
  mode: RoundingMode,
): Duration {
  if (largest >= 4)
    return balanceDuration(
      roundNanoseconds(end - start, unitNanoseconds(smallest) * BigInt(increment), mode),
      largest,
    );
  if (start === end) return new Duration();
  const local = localNanoseconds(start, zone);
  const startDay = Number(floorDivide(local, NS_PER_DAY));
  const startTime = Number(local - BigInt(startDay) * NS_PER_DAY);
  const raw = difference(start, end, zone, startDay, startTime, largest);
  if (smallest === 9 && increment === 1) return raw;
  const sign = end > start ? 1 : -1;
  let years = Duration.field(raw, 0);
  let months = Duration.field(raw, 1);
  let weeks = Duration.field(raw, 2);
  let days = Duration.field(raw, 3);
  if (smallest >= 4) {
    const day = addISODate(startDay, years, months, weeks, days, "constrain");
    const from = resolveLocalDateTime(day, startTime, zone, "compatible");
    const to = resolveLocalDateTime(day + sign, startTime, zone, "compatible");
    const span = to - from;
    if (sign > 0 ? span <= 0n : span >= 0n)
      throw new Error("Time-zone provider returned inconsistent rounding boundaries");
    const quantum = unitNanoseconds(smallest) * BigInt(increment);
    let time = roundNanoseconds(elapsed(raw), quantum, mode);
    const beyond = time - span;
    const expanded = sign > 0 ? beyond >= 0n : beyond <= 0n;
    if (expanded) {
      days += sign;
      time = roundNanoseconds(beyond, quantum, mode);
    }
    const result = balanceDuration(time, 4, years, months, weeks, days);
    return !expanded || largest === 3
      ? result
      : bubble(
          start,
          startDay,
          startTime,
          zone,
          result,
          (expanded ? to : from) + time,
          sign,
          largest,
          3,
        );
  }
  const amount =
    smallest === 0
      ? years
      : smallest === 1
        ? months
        : smallest === 2
          ? weeks + Math.trunc(days / 7)
          : days;
  let quotient = Math.trunc(amount / increment);
  years = smallest > 0 ? years : quotient * increment;
  months = smallest > 1 ? months : smallest === 1 ? quotient * increment : 0;
  weeks = smallest > 2 ? weeks : smallest === 2 ? quotient * increment : 0;
  days = smallest === 3 ? quotient * increment : 0;
  let lower = boundary(start, startDay, startTime, zone, years, months, weeks, days);
  let upper = boundary(
    start,
    startDay,
    startTime,
    zone,
    years + (smallest === 0 ? increment * sign : 0),
    months + (smallest === 1 ? increment * sign : 0),
    weeks + (smallest === 2 ? increment * sign : 0),
    days + (smallest === 3 ? increment * sign : 0),
  );
  let shifted = false;
  if (sign > 0 ? end < lower || end > upper : end > lower || end < upper) {
    quotient += sign;
    years += smallest === 0 ? increment * sign : 0;
    months += smallest === 1 ? increment * sign : 0;
    weeks += smallest === 2 ? increment * sign : 0;
    days += smallest === 3 ? increment * sign : 0;
    lower = upper;
    upper = boundary(
      start,
      startDay,
      startTime,
      zone,
      years + (smallest === 0 ? increment * sign : 0),
      months + (smallest === 1 ? increment * sign : 0),
      weeks + (smallest === 2 ? increment * sign : 0),
      days + (smallest === 3 ? increment * sign : 0),
    );
    shifted = true;
  }
  const span = upper > lower ? upper - lower : lower - upper;
  if (span === 0n) throw new Error("Time-zone provider returned an empty rounding interval");
  const selected = roundNanoseconds(BigInt(quotient) * span + end - lower, span, mode) / span;
  const expanded = selected !== BigInt(quotient);
  if (expanded) {
    years += smallest === 0 ? increment * sign : 0;
    months += smallest === 1 ? increment * sign : 0;
    weeks += smallest === 2 ? increment * sign : 0;
    days += smallest === 3 ? increment * sign : 0;
  }
  const result = new Duration(years, months, weeks, days);
  if (smallest === 2 || (!shifted && !expanded)) return result;
  return bubble(
    start,
    startDay,
    startTime,
    zone,
    result,
    expanded ? upper : lower,
    sign,
    largest,
    smallest,
  );
}
