import {
  dateFromTime,
  hourFromTime,
  millisecondFromTime,
  minuteFromTime,
  monthFromTime,
  secondFromTime,
  timeClip,
  weekDay,
  yearFromTime,
} from "./calendar.ts";
import { dateLocal, dateUTC, setComponent } from "./operations.ts";
import { formatDate, formatISO, formatLocal, formatTime, formatUTC } from "./format.ts";
import { parseDate } from "./parse.ts";
import { localTime, UTC } from "../time/provider.ts";
import type { TimeHost, TimeZoneRules } from "../time/provider.ts";
import type { DateComponent } from "./operations.ts";

// Standard builtin lowering supplies the host zone and already-converted
// numeric arguments. Each value owns only its mutable clipped timestamp;
// clock, locale and zone capabilities are kept outside individual dates.
export class NtsDate implements Omit<
  Date,
  | typeof Symbol.toPrimitive
  | "toJSON" // The pinned lib says string; invalid Date serializes as null.
  | "toLocaleString"
  | "toLocaleDateString"
  | "toLocaleTimeString"
  | "toTemporalInstant"
  | "getVarDate" // Legacy ActiveX augmentation from lib.dom, outside ECMA-262.
> {
  #milliseconds: number;
  constructor(milliseconds: number) {
    this.#milliseconds = timeClip(milliseconds);
  }
  static from(value: number | string | NtsDate, zone: TimeZoneRules = UTC): NtsDate {
    return new NtsDate(
      typeof value === "string"
        ? parseDate(value, zone)
        : typeof value === "number"
          ? value
          : value.#milliseconds,
    );
  }
  static fromLocal(
    zone: TimeZoneRules,
    year: number,
    month: number,
    day = 1,
    hour = 0,
    minute = 0,
    second = 0,
    millisecond = 0,
  ): NtsDate {
    return new NtsDate(dateLocal(year, month, day, hour, minute, second, millisecond, zone));
  }
  static parse(value: string, zone: TimeZoneRules = UTC): number {
    return parseDate(value, zone);
  }
  static UTC(
    year: number,
    month = 0,
    day = 1,
    hour = 0,
    minute = 0,
    second = 0,
    millisecond = 0,
  ): number {
    return dateUTC(year, month, day, hour, minute, second, millisecond);
  }
  getTime(): number {
    return this.#milliseconds;
  }
  valueOf(): number {
    return this.#milliseconds;
  }
  getUTCFullYear(): number {
    return yearFromTime(this.#milliseconds);
  }
  getUTCMonth(): number {
    return monthFromTime(this.#milliseconds);
  }
  getUTCDate(): number {
    return dateFromTime(this.#milliseconds);
  }
  getUTCDay(): number {
    return weekDay(this.#milliseconds);
  }
  getUTCHours(): number {
    return hourFromTime(this.#milliseconds);
  }
  getUTCMinutes(): number {
    return minuteFromTime(this.#milliseconds);
  }
  getUTCSeconds(): number {
    return secondFromTime(this.#milliseconds);
  }
  getUTCMilliseconds(): number {
    return millisecondFromTime(this.#milliseconds);
  }
  getFullYear(zone: TimeZoneRules = UTC): number {
    return yearFromTime(localTime(this.#milliseconds, zone));
  }
  getMonth(zone: TimeZoneRules = UTC): number {
    return monthFromTime(localTime(this.#milliseconds, zone));
  }
  getDate(zone: TimeZoneRules = UTC): number {
    return dateFromTime(localTime(this.#milliseconds, zone));
  }
  getDay(zone: TimeZoneRules = UTC): number {
    return weekDay(localTime(this.#milliseconds, zone));
  }
  getHours(zone: TimeZoneRules = UTC): number {
    return hourFromTime(localTime(this.#milliseconds, zone));
  }
  getMinutes(zone: TimeZoneRules = UTC): number {
    return minuteFromTime(localTime(this.#milliseconds, zone));
  }
  getSeconds(zone: TimeZoneRules = UTC): number {
    return secondFromTime(localTime(this.#milliseconds, zone));
  }
  getMilliseconds(zone: TimeZoneRules = UTC): number {
    return millisecondFromTime(localTime(this.#milliseconds, zone));
  }
  getTimezoneOffset(zone: TimeZoneRules = UTC): number {
    if (Number.isNaN(this.#milliseconds)) return NaN;
    const offset = zone.offsetMilliseconds(this.#milliseconds);
    return offset === 0 ? 0 : -offset / 60000;
  }
  setTime(milliseconds: number): number {
    this.#milliseconds = timeClip(milliseconds);
    return this.#milliseconds;
  }
  // Scalar entry point preserves supplied-argument count for standard lowering,
  // including explicitly supplied undefined converted to NaN at that boundary.
  setComponent(
    kind: DateComponent,
    first: number,
    second: number,
    third: number,
    fourth: number,
    count: number,
    local: boolean,
    zone: TimeZoneRules,
  ): number {
    this.#milliseconds = setComponent(
      this.#milliseconds,
      kind,
      first,
      second,
      third,
      fourth,
      count,
      local,
      zone,
    );
    return this.#milliseconds;
  }
  #setUTCComponent(
    kind: DateComponent,
    first: number,
    second: number,
    third: number,
    fourth: number,
    count: number,
  ): number {
    return this.setTime(
      setComponent(this.#milliseconds, kind, first, second, third, fourth, count, false, UTC),
    );
  }
  setUTCFullYear(year: number, month?: number, day?: number): number {
    return this.#setUTCComponent(
      "year",
      year,
      month ?? 0,
      day ?? 0,
      0,
      day !== undefined ? 3 : month !== undefined ? 2 : 1,
    );
  }
  setFullYear(year: number, month?: number, day?: number, zone: TimeZoneRules = UTC): number {
    return this.setComponent(
      "year",
      year,
      month ?? 0,
      day ?? 0,
      0,
      day !== undefined ? 3 : month !== undefined ? 2 : 1,
      true,
      zone,
    );
  }
  setUTCMonth(month: number, day?: number): number {
    return this.#setUTCComponent("month", month, day ?? 0, 0, 0, day === undefined ? 1 : 2);
  }
  setMonth(month: number, day?: number, zone: TimeZoneRules = UTC): number {
    return this.setComponent("month", month, day ?? 0, 0, 0, day === undefined ? 1 : 2, true, zone);
  }
  setUTCDate(day: number): number {
    return this.#setUTCComponent("day", day, 0, 0, 0, 1);
  }
  setDate(day: number, zone: TimeZoneRules = UTC): number {
    return this.setComponent("day", day, 0, 0, 0, 1, true, zone);
  }
  setUTCHours(hour: number, minute?: number, second?: number, millisecond?: number): number {
    return this.#setUTCComponent(
      "hour",
      hour,
      minute ?? 0,
      second ?? 0,
      millisecond ?? 0,
      millisecond !== undefined ? 4 : second !== undefined ? 3 : minute !== undefined ? 2 : 1,
    );
  }
  setHours(
    hour: number,
    minute?: number,
    second?: number,
    millisecond?: number,
    zone: TimeZoneRules = UTC,
  ): number {
    return this.setComponent(
      "hour",
      hour,
      minute ?? 0,
      second ?? 0,
      millisecond ?? 0,
      millisecond !== undefined ? 4 : second !== undefined ? 3 : minute !== undefined ? 2 : 1,
      true,
      zone,
    );
  }
  setUTCMinutes(minute: number, second?: number, millisecond?: number): number {
    return this.#setUTCComponent(
      "minute",
      minute,
      second ?? 0,
      millisecond ?? 0,
      0,
      millisecond !== undefined ? 3 : second !== undefined ? 2 : 1,
    );
  }
  setMinutes(
    minute: number,
    second?: number,
    millisecond?: number,
    zone: TimeZoneRules = UTC,
  ): number {
    return this.setComponent(
      "minute",
      minute,
      second ?? 0,
      millisecond ?? 0,
      0,
      millisecond !== undefined ? 3 : second !== undefined ? 2 : 1,
      true,
      zone,
    );
  }
  setUTCSeconds(second: number, millisecond?: number): number {
    return this.#setUTCComponent(
      "second",
      second,
      millisecond ?? 0,
      0,
      0,
      millisecond === undefined ? 1 : 2,
    );
  }
  setSeconds(second: number, millisecond?: number, zone: TimeZoneRules = UTC): number {
    return this.setComponent(
      "second",
      second,
      millisecond ?? 0,
      0,
      0,
      millisecond === undefined ? 1 : 2,
      true,
      zone,
    );
  }
  setUTCMilliseconds(millisecond: number): number {
    return this.#setUTCComponent("millisecond", millisecond, 0, 0, 0, 1);
  }
  setMilliseconds(millisecond: number, zone: TimeZoneRules = UTC): number {
    return this.setComponent("millisecond", millisecond, 0, 0, 0, 1, true, zone);
  }
  toISOString(): string {
    return formatISO(this.#milliseconds);
  }
  toUTCString(): string {
    return formatUTC(this.#milliseconds);
  }
  toString(zone: TimeZoneRules = UTC): string {
    return formatLocal(this.#milliseconds, zone);
  }
  toDateString(zone: TimeZoneRules = UTC): string {
    return formatDate(this.#milliseconds, zone);
  }
  toTimeString(zone: TimeZoneRules = UTC): string {
    return formatTime(this.#milliseconds, zone);
  }
  toJSON(): string | null {
    return Number.isFinite(this.#milliseconds) ? formatISO(this.#milliseconds) : null;
  }
}

export function dateNow<H extends TimeHost>(host: H): number {
  return timeClip(host.nowMilliseconds());
}
