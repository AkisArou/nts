import {
  dateFromTime,
  hourFromTime,
  makeDate,
  makeDay,
  makeTime,
  millisecondFromTime,
  minuteFromTime,
  monthFromTime,
  secondFromTime,
  timeClip,
  yearFromTime,
  MS_PER_DAY,
} from "./calendar.ts";
import { localTime, utcTime } from "../time/provider.ts";
import type { TimeZoneRules } from "../time/provider.ts";

export function constructorYear(year: number): number {
  const integer = Math.trunc(year);
  return integer >= 0 && integer <= 99 ? 1900 + integer : year;
}

export function dateUTC(
  year: number,
  month = 0,
  day = 1,
  hour = 0,
  minute = 0,
  second = 0,
  millisecond = 0,
): number {
  return timeClip(
    makeDate(
      makeDay(constructorYear(year), month, day),
      makeTime(hour, minute, second, millisecond),
    ),
  );
}

export function dateLocal(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
  millisecond: number,
  zone: TimeZoneRules,
): number {
  return timeClip(
    utcTime(
      makeDate(
        makeDay(constructorYear(year), month, day),
        makeTime(hour, minute, second, millisecond),
      ),
      zone,
    ),
  );
}

// Date exposes calendar components and time through millisecond precision.
export type DateComponent = Exclude<
  Temporal.DateUnit | Temporal.TimeUnit,
  "week" | "microsecond" | "nanosecond"
>;

// Scalar boundary for compiler lowering. It supplies numeric arguments and
// their original count; ordinary typed callers use the class convenience methods.
export function setComponent(
  current: number,
  kind: DateComponent,
  first: number,
  second: number,
  third: number,
  fourth: number,
  count: number,
  local: boolean,
  zone: TimeZoneRules,
): number {
  let time = current;
  const invalid = Number.isNaN(time);
  if (invalid && kind === "year") time = 0;
  else if (Number.isNaN(time)) return NaN;
  if (local && !invalid) time = localTime(time, zone);
  let year = yearFromTime(time);
  let month = monthFromTime(time);
  let day = dateFromTime(time);
  let hour = hourFromTime(time);
  let minute = minuteFromTime(time);
  let sec = secondFromTime(time);
  let ms = millisecondFromTime(time);
  if (kind === "year") {
    year = first;
    if (count > 1) month = second;
    if (count > 2) day = third;
  } else if (kind === "month") {
    month = first;
    if (count > 1) day = second;
  } else if (kind === "day") day = first;
  else if (kind === "hour") {
    hour = first;
    if (count > 1) minute = second;
    if (count > 2) sec = third;
    if (count > 3) ms = fourth;
  } else if (kind === "minute") {
    minute = first;
    if (count > 1) sec = second;
    if (count > 2) ms = third;
  } else if (kind === "second") {
    sec = first;
    if (count > 1) ms = second;
  } else ms = first;
  const dayNumber =
    kind === "year" || kind === "month" || kind === "day"
      ? makeDay(year, month, day)
      : Math.floor(time / MS_PER_DAY);
  const result = makeDate(dayNumber, makeTime(hour, minute, sec, ms));
  return timeClip(local ? utcTime(result, zone) : result);
}
