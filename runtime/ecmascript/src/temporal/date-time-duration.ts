import { addDate } from "./calendar-date.ts";
import type { CalendarContext } from "./calendar-context.ts";
import { differenceDate } from "./date-duration.ts";
import { Duration, balanceDuration, timeUnitIndex, unitNanoseconds } from "./duration.ts";
import { NS_PER_DAY, roundNanoseconds } from "./exact.ts";
import type { RoundingMode } from "./exact.ts";
import { dateUnitIndex } from "./iso-date.ts";

export { checkDateTime } from "./iso-date.ts";
export function dateTimeUnitIndex(value: string): number {
  if (typeof value === "symbol") throw new TypeError("Temporal string options reject Symbols");
  const unit = String(value);
  return unit === "year" ||
    unit === "years" ||
    unit === "month" ||
    unit === "months" ||
    unit === "week" ||
    unit === "weeks" ||
    unit === "day" ||
    unit === "days"
    ? dateUnitIndex(unit)
    : timeUnitIndex(unit);
}

function difference(
  startDay: number,
  startTime: number,
  endDay: number,
  endTime: number,
  largest: number,
  calendar: CalendarContext | undefined,
): Duration {
  const time = endTime - startTime;
  if (largest >= 4)
    return balanceDuration(BigInt(endDay - startDay) * NS_PER_DAY + BigInt(time), largest);
  const sign = endDay > startDay ? 1 : endDay < startDay ? -1 : 0;
  const adjustment = sign * time < 0 ? -sign : 0;
  const date = differenceDate(startDay, endDay + adjustment, largest, calendar);
  return balanceDuration(
    BigInt(date.days - adjustment) * NS_PER_DAY + BigInt(time),
    3,
    date.years,
    date.months,
    date.weeks,
  );
}

function bubble(
  startDay: number,
  startTime: number,
  nudged: bigint,
  raw: Duration,
  sign: number,
  largest: number,
  smallest: number,
  calendar: CalendarContext | undefined,
): Duration {
  let result = raw;
  for (let unit = smallest - 1; unit >= largest; unit--) {
    if (unit === 2 && largest !== 2) continue;
    const years = result.years + (unit === 0 ? sign : 0);
    const months = unit === 0 ? 0 : result.months + (unit === 1 ? sign : 0);
    const weeks = unit <= 1 ? 0 : result.weeks + sign;
    const day = addDate(startDay, years, months, weeks, 0, "constrain", calendar);
    const boundary = BigInt(day) * NS_PER_DAY + BigInt(startTime);
    if (sign > 0 ? nudged < boundary : nudged > boundary) break;
    result = new Duration(years, months, weeks);
  }
  return result;
}

// Calendar rounding uses exact distances between actual calendar boundaries.
// No month-length approximation or floating-point fraction enters the choice.
export function roundDateTimeDifference(
  startDay: number,
  startTime: number,
  endDay: number,
  endTime: number,
  largest: number,
  smallest: number,
  increment: number,
  mode: RoundingMode,
  calendar: CalendarContext | undefined = undefined,
): Duration {
  const raw = difference(startDay, startTime, endDay, endTime, largest, calendar);
  if (raw.blank || (smallest === 9 && increment === 1)) return raw;
  const sign = raw.sign;
  const origin = BigInt(startDay) * NS_PER_DAY + BigInt(startTime);
  const destination = BigInt(endDay) * NS_PER_DAY + BigInt(endTime);
  if (smallest >= 3) {
    const time = Duration.timeNanoseconds(raw);
    const rounded = roundNanoseconds(time, unitNanoseconds(smallest) * BigInt(increment), mode);
    const result = balanceDuration(
      rounded,
      largest >= 4 ? largest : 3,
      raw.years,
      raw.months,
      raw.weeks,
    );
    const expanded = sign * Number(rounded / NS_PER_DAY - time / NS_PER_DAY) > 0;
    if (!expanded || largest >= 3) return result;
    return bubble(
      startDay,
      startTime,
      destination + rounded - time,
      result,
      sign,
      largest,
      3,
      calendar,
    );
  }
  const amount =
    smallest === 0 ? raw.years : smallest === 1 ? raw.months : raw.weeks + Math.trunc(raw.days / 7);
  let quotient = Math.trunc(amount / increment);
  let years = smallest > 0 ? raw.years : quotient * increment;
  let months = smallest > 1 ? raw.months : smallest === 1 ? quotient * increment : 0;
  let weeks = smallest === 2 ? quotient * increment : 0;
  let lower =
    years === 0 && months === 0 && weeks === 0
      ? origin
      : BigInt(addDate(startDay, years, months, weeks, 0, "constrain", calendar)) * NS_PER_DAY +
        BigInt(startTime);
  let upper =
    BigInt(
      addDate(
        startDay,
        years + (smallest === 0 ? increment * sign : 0),
        months + (smallest === 1 ? increment * sign : 0),
        weeks + (smallest === 2 ? increment * sign : 0),
        0,
        "constrain",
        calendar,
      ),
    ) *
      NS_PER_DAY +
    BigInt(startTime);
  let shifted = false;
  if (
    smallest < 2 &&
    (sign > 0
      ? destination > upper || destination < lower
      : destination < upper || destination > lower)
  ) {
    quotient += sign;
    years += smallest === 0 ? increment * sign : 0;
    months += smallest === 1 ? increment * sign : 0;
    lower = upper;
    upper =
      BigInt(
        addDate(
          startDay,
          years + (smallest === 0 ? increment * sign : 0),
          months + (smallest === 1 ? increment * sign : 0),
          weeks,
          0,
          "constrain",
          calendar,
        ),
      ) *
        NS_PER_DAY +
      BigInt(startTime);
    shifted = true;
  }
  const span = upper > lower ? upper - lower : lower - upper;
  const selected =
    roundNanoseconds(BigInt(quotient) * span + destination - lower, span, mode) / span;
  const expanded = selected !== BigInt(quotient);
  if (expanded) {
    years += smallest === 0 ? increment * sign : 0;
    months += smallest === 1 ? increment * sign : 0;
    weeks += smallest === 2 ? increment * sign : 0;
  }
  const result = new Duration(years, months, weeks);
  if (smallest === 2 || (!expanded && !shifted)) return result;
  return bubble(
    startDay,
    startTime,
    expanded ? upper : lower,
    result,
    sign,
    largest,
    smallest,
    calendar,
  );
}
