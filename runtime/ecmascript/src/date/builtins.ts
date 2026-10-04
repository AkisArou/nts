import type { TimeLocaleSource } from "../time/locale-source.ts";
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

function number(value: number | undefined): number {
  return value === undefined ? NaN : +value;
}

// Standard builtin lowering supplies the host zone and already-converted
// numeric arguments. Each value owns only its mutable clipped timestamp;
// clock, locale and zone capabilities are kept outside individual dates.
export class NtsDate {
  #milliseconds: number;
  constructor(milliseconds: number) {
    this.#milliseconds = timeClip(milliseconds);
  }
  static milliseconds(value: NtsDate): number {
    return value.#milliseconds;
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
  static UTC(...args: Parameters<DateConstructor["UTC"]>): number {
    return dateUTC(
      number(args[0]),
      args.length > 1 ? number(args[1]) : 0,
      args.length > 2 ? number(args[2]) : 1,
      args.length > 3 ? number(args[3]) : 0,
      args.length > 4 ? number(args[4]) : 0,
      args.length > 5 ? number(args[5]) : 0,
      args.length > 6 ? number(args[6]) : 0,
    );
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
    this.#milliseconds;
    this.#milliseconds = timeClip(number(milliseconds));
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
    return this.#change(this.#milliseconds, kind, first, second, third, fourth, count, local, zone);
  }
  #change(
    current: number,
    kind: DateComponent,
    first: number,
    second: number,
    third: number,
    fourth: number,
    count: number,
    local = false,
    zone: TimeZoneRules = UTC,
  ): number {
    // Conversion can mutate the receiver. An invalid original value returns
    // without committing, except for setFullYear's specified epoch fallback.
    if (Number.isNaN(current) && kind !== "year") return NaN;
    this.#milliseconds = setComponent(
      current,
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
  setUTCFullYear(...args: Parameters<Date["setUTCFullYear"]>): number {
    return this.#change(
      this.#milliseconds,
      "year",
      number(args[0]),
      number(args[1]),
      number(args[2]),
      0,
      args.length,
    );
  }
  setFullYear(...args: Parameters<Date["setFullYear"]>): number {
    return this.#change(
      this.#milliseconds,
      "year",
      number(args[0]),
      number(args[1]),
      number(args[2]),
      0,
      args.length,
      true,
      UTC,
    );
  }
  setUTCMonth(...args: Parameters<Date["setUTCMonth"]>): number {
    return this.#change(
      this.#milliseconds,
      "month",
      number(args[0]),
      number(args[1]),
      0,
      0,
      args.length,
    );
  }
  setMonth(...args: Parameters<Date["setMonth"]>): number {
    return this.#change(
      this.#milliseconds,
      "month",
      number(args[0]),
      number(args[1]),
      0,
      0,
      args.length,
      true,
      UTC,
    );
  }
  setUTCDate(day: number): number {
    return this.#change(this.#milliseconds, "day", number(day), 0, 0, 0, 1);
  }
  setDate(day: number, zone: TimeZoneRules = UTC): number {
    return this.#change(this.#milliseconds, "day", number(day), 0, 0, 0, 1, true, zone);
  }
  setUTCHours(...args: Parameters<Date["setUTCHours"]>): number {
    return this.#change(
      this.#milliseconds,
      "hour",
      number(args[0]),
      number(args[1]),
      number(args[2]),
      number(args[3]),
      args.length,
    );
  }
  setHours(...args: Parameters<Date["setHours"]>): number {
    return this.#change(
      this.#milliseconds,
      "hour",
      number(args[0]),
      number(args[1]),
      number(args[2]),
      number(args[3]),
      args.length,
      true,
      UTC,
    );
  }
  setUTCMinutes(...args: Parameters<Date["setUTCMinutes"]>): number {
    return this.#change(
      this.#milliseconds,
      "minute",
      number(args[0]),
      number(args[1]),
      number(args[2]),
      0,
      args.length,
    );
  }
  setMinutes(...args: Parameters<Date["setMinutes"]>): number {
    return this.#change(
      this.#milliseconds,
      "minute",
      number(args[0]),
      number(args[1]),
      number(args[2]),
      0,
      args.length,
      true,
      UTC,
    );
  }
  setUTCSeconds(...args: Parameters<Date["setUTCSeconds"]>): number {
    return this.#change(
      this.#milliseconds,
      "second",
      number(args[0]),
      number(args[1]),
      0,
      0,
      args.length,
    );
  }
  setSeconds(...args: Parameters<Date["setSeconds"]>): number {
    return this.#change(
      this.#milliseconds,
      "second",
      number(args[0]),
      number(args[1]),
      0,
      0,
      args.length,
      true,
      UTC,
    );
  }
  setUTCMilliseconds(millisecond: number): number {
    return this.#change(this.#milliseconds, "millisecond", number(millisecond), 0, 0, 0, 1);
  }
  setMilliseconds(millisecond: number, zone: TimeZoneRules = UTC): number {
    return this.#change(
      this.#milliseconds,
      "millisecond",
      number(millisecond),
      0,
      0,
      0,
      1,
      true,
      zone,
    );
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
  toLocaleString(
    locales: Intl.LocalesArgument = undefined,
    options: Readonly<Intl.DateTimeFormatOptions> | undefined = undefined,
    source: TimeLocaleSource | undefined = undefined,
  ): string {
    const milliseconds = this.#milliseconds;
    if (Number.isNaN(milliseconds)) return "Invalid Date";
    if (source === undefined) return formatLocal(milliseconds, UTC);
    return source.formatDateTime(7, milliseconds, "iso8601", locales, options, undefined);
  }
  toLocaleDateString(
    locales: Intl.LocalesArgument = undefined,
    options: Readonly<Intl.DateTimeFormatOptions> | undefined = undefined,
    source: TimeLocaleSource | undefined = undefined,
  ): string {
    const milliseconds = this.#milliseconds;
    if (Number.isNaN(milliseconds)) return "Invalid Date";
    if (source === undefined) return formatDate(milliseconds, UTC);
    return source.formatDateTime(8, milliseconds, "iso8601", locales, options, undefined);
  }
  toLocaleTimeString(
    locales: Intl.LocalesArgument = undefined,
    options: Readonly<Intl.DateTimeFormatOptions> | undefined = undefined,
    source: TimeLocaleSource | undefined = undefined,
  ): string {
    const milliseconds = this.#milliseconds;
    if (Number.isNaN(milliseconds)) return "Invalid Date";
    if (source === undefined) return formatTime(milliseconds, UTC);
    return source.formatDateTime(9, milliseconds, "iso8601", locales, options, undefined);
  }
  toJSON(_key?: unknown): string | null {
    const primitive = this.valueOf();
    if (typeof primitive === "number" && !Number.isFinite(primitive)) return null;
    return this.toISOString();
  }
}

export function dateNow<H extends TimeHost>(host: H): number {
  return timeClip(host.nowMilliseconds());
}
