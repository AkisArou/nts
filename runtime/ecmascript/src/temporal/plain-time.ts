import type { TimeLocaleSource } from "../time/locale-source.ts";
import { ISOParser } from "./iso-parser.ts";
import { NS_PER_DAY, roundNanoseconds } from "./exact.ts";
import {
  Duration,
  toDuration,
  balanceDuration,
  timeUnitIndex,
  unitNanoseconds,
} from "./duration.ts";
import {
  fractionalSecondDigits,
  integerWithTruncation,
  overflowOption,
  requireOptions,
  roundingIncrement,
  roundingMode,
  secondsStringPrecision,
  validateIncrement,
} from "./options.ts";
import { formatPlainTime, timeNanoseconds } from "./iso-time.ts";
import { regulateTimeField } from "./iso-fields.ts";
import { PlainDateTime } from "./plain-date-time.ts";
import { ZonedDateTime } from "./zoned-date-time.ts";
import { isPlainCalendar } from "./plain-calendar.ts";

function withinDay(value: bigint): number {
  const remainder = value % NS_PER_DAY;
  return Number(remainder < 0n ? remainder + NS_PER_DAY : remainder);
}

function timeFields(
  value: Readonly<Temporal.TimeLikeObject>,
  options: Readonly<Temporal.OverflowOptions> | undefined,
  previous = 0,
): PlainTime {
  // Convert each field as it is read, in the specification's alphabetical
  // order. The six values stay in scalars, with no temporary field record.
  const rawHour = value.hour;
  const hour =
    rawHour === undefined ? Math.floor(previous / 3600000000000) : integerWithTruncation(rawHour);
  const rawMicrosecond = value.microsecond;
  const microsecond =
    rawMicrosecond === undefined
      ? Math.floor(previous / 1000) % 1000
      : integerWithTruncation(rawMicrosecond);
  const rawMillisecond = value.millisecond;
  const millisecond =
    rawMillisecond === undefined
      ? Math.floor(previous / 1e6) % 1000
      : integerWithTruncation(rawMillisecond);
  const rawMinute = value.minute;
  const minute =
    rawMinute === undefined
      ? Math.floor(previous / 60000000000) % 60
      : integerWithTruncation(rawMinute);
  const rawNanosecond = value.nanosecond;
  const nanosecond =
    rawNanosecond === undefined ? previous % 1000 : integerWithTruncation(rawNanosecond);
  const rawSecond = value.second;
  const second =
    rawSecond === undefined ? Math.floor(previous / 1e9) % 60 : integerWithTruncation(rawSecond);
  if (
    rawHour === undefined &&
    rawMicrosecond === undefined &&
    rawMillisecond === undefined &&
    rawMinute === undefined &&
    rawNanosecond === undefined &&
    rawSecond === undefined
  )
    throw new TypeError("At least one Temporal time field is required");
  const overflow = overflowOption(options);
  return new PlainTime(
    regulateTimeField(hour, 23, overflow),
    regulateTimeField(minute, 59, overflow),
    regulateTimeField(second, 59, overflow),
    regulateTimeField(millisecond, 999, overflow),
    regulateTimeField(microsecond, 999, overflow),
    regulateTimeField(nanosecond, 999, overflow),
  );
}

export function createPlainTime(value: number): PlainTime {
  return new PlainTime(
    Math.floor(value / 3600000000000),
    Math.floor(value / 60000000000) % 60,
    Math.floor(value / 1e9) % 60,
    Math.floor(value / 1e6) % 1000,
    Math.floor(value / 1000) % 1000,
    value % 1000,
  );
}

// A time of day has fewer than 2^47 nanoseconds: one binary64 integer stores
// the entire immutable value exactly. BigInt is needed only for arithmetic
// with arbitrary supported duration magnitudes, before reducing into the day.
export class PlainTime {
  readonly #time: number;

  constructor(hour = 0, minute = 0, second = 0, millisecond = 0, microsecond = 0, nanosecond = 0) {
    this.#time = timeNanoseconds(hour, minute, second, millisecond, microsecond, nanosecond);
  }

  // Intl formats plain values in UTC and must read their immutable slot.
  static nanoseconds(value: PlainTime): number {
    return value.#time;
  }
  static from(
    item: Temporal.PlainTimeLike,
    options: Readonly<Temporal.OverflowOptions> | undefined = undefined,
  ): PlainTime {
    if (item instanceof ZonedDateTime) {
      const time = ZonedDateTime.nanoseconds(item);
      overflowOption(options);
      return createPlainTime(time);
    }
    if (item instanceof PlainTime) {
      overflowOption(options);
      return createPlainTime(item.#time);
    }
    if (item instanceof PlainDateTime) {
      overflowOption(options);
      return createPlainTime(PlainDateTime.nanoseconds(item));
    }
    if (typeof item === "string") {
      const parsed = new ISOParser(item, true);
      if (parsed.utcDesignator)
        throw new RangeError("PlainTime strings must not have a UTC designator");
      overflowOption(options);
      return createPlainTime(parsed.timeNanoseconds());
    }
    if (item === null || typeof item !== "object")
      throw new TypeError("PlainTime requires a time object or string");
    return timeFields(item, options);
  }
  static compare(one: Temporal.PlainTimeLike, two: Temporal.PlainTimeLike): number {
    const a = one instanceof PlainTime ? one.#time : PlainTime.from(one).#time;
    const b = two instanceof PlainTime ? two.#time : PlainTime.from(two).#time;
    return a < b ? -1 : a > b ? 1 : 0;
  }

  get hour(): number {
    return Math.floor(this.#time / 3600000000000);
  }
  get minute(): number {
    return Math.floor(this.#time / 60000000000) % 60;
  }
  get second(): number {
    return Math.floor(this.#time / 1e9) % 60;
  }
  get millisecond(): number {
    return Math.floor(this.#time / 1e6) % 1000;
  }
  get microsecond(): number {
    return Math.floor(this.#time / 1000) % 1000;
  }
  get nanosecond(): number {
    return this.#time % 1000;
  }

  add(duration: Temporal.DurationLike): PlainTime {
    const time = this.#time;
    return createPlainTime(
      withinDay(BigInt(time) + Duration.timeNanoseconds(toDuration(duration))),
    );
  }
  subtract(duration: Temporal.DurationLike): PlainTime {
    const time = this.#time;
    return createPlainTime(
      withinDay(BigInt(time) - Duration.timeNanoseconds(toDuration(duration))),
    );
  }
  with(
    timeLike: Readonly<Temporal.PartialTemporalLike<Temporal.TimeLikeObject>>,
    options: Readonly<Temporal.OverflowOptions> | undefined = undefined,
  ): PlainTime {
    // Reading owned state before any input getters also validates the receiver.
    const time = this.#time;
    if (
      timeLike === null ||
      typeof timeLike !== "object" ||
      timeLike instanceof PlainTime ||
      isPlainCalendar(timeLike)
    )
      throw new TypeError("with requires a partial time field object");
    const fields: Readonly<
      Temporal.PartialTemporalLike<Temporal.TimeLikeObject> &
        Partial<Pick<Temporal.ZonedDateTimeLikeObject, "calendar" | "timeZone">>
    > = timeLike;
    if (fields.calendar !== undefined || fields.timeZone !== undefined)
      throw new TypeError("Partial Temporal objects must not include calendar or timeZone");
    return timeFields(timeLike, options, time);
  }
  private difference(
    other: Temporal.PlainTimeLike,
    options: Readonly<Temporal.RoundingOptionsWithLargestUnit<Temporal.TimeUnit>> | undefined,
    since: boolean,
  ): Duration {
    const time = this.#time;
    const target = other instanceof PlainTime ? other.#time : PlainTime.from(other).#time;
    if (options !== undefined) requireOptions(options);
    const largestOption = options?.largestUnit;
    if (typeof largestOption === "symbol")
      throw new TypeError("Temporal string options reject Symbols");
    const largestText = largestOption === undefined ? "auto" : String(largestOption);
    const increment = roundingIncrement(options?.roundingIncrement);
    const mode = roundingMode(options?.roundingMode);
    const smallestOption = options?.smallestUnit;
    const smallest = timeUnitIndex(smallestOption === undefined ? "nanosecond" : smallestOption);
    const largest = largestText === "auto" ? 4 : timeUnitIndex(largestText);
    if (largest < 4 || smallest < 4 || largest > smallest)
      throw new RangeError("Invalid PlainTime difference units");
    validateIncrement(smallest, increment);
    const delta = BigInt(since ? time - target : target - time);
    return balanceDuration(
      roundNanoseconds(delta, unitNanoseconds(smallest) * BigInt(increment), mode),
      largest,
    );
  }
  until(
    other: Temporal.PlainTimeLike,
    options:
      | Readonly<Temporal.RoundingOptionsWithLargestUnit<Temporal.TimeUnit>>
      | undefined = undefined,
  ): Duration {
    return this.difference(other, options, false);
  }
  since(
    other: Temporal.PlainTimeLike,
    options:
      | Readonly<Temporal.RoundingOptionsWithLargestUnit<Temporal.TimeUnit>>
      | undefined = undefined,
  ): Duration {
    return this.difference(other, options, true);
  }
  equals(other: Temporal.PlainTimeLike): boolean {
    const time = this.#time;
    return time === (other instanceof PlainTime ? other.#time : PlainTime.from(other).#time);
  }

  round(
    roundTo:
      | Temporal.PluralizeUnit<Temporal.TimeUnit>
      | Readonly<Temporal.RoundingOptions<Temporal.TimeUnit>>,
  ): PlainTime {
    const time = this.#time;
    if (roundTo === undefined || roundTo === null)
      throw new TypeError("PlainTime.round requires options");
    let increment = 1;
    let mode = roundingMode("halfExpand");
    let unit: Temporal.PluralizeUnit<Temporal.TimeUnit> | undefined;
    if (typeof roundTo === "string") unit = roundTo;
    else {
      requireOptions(roundTo);
      increment = roundingIncrement(roundTo.roundingIncrement);
      const modeOption = roundTo.roundingMode;
      mode = roundingMode(modeOption === undefined ? "halfExpand" : modeOption);
      unit = roundTo.smallestUnit;
    }
    if (unit === undefined) throw new RangeError("smallestUnit is required");
    const index = timeUnitIndex(unit);
    if (index < 4) throw new RangeError("Invalid PlainTime rounding unit");
    validateIncrement(index, increment);
    return createPlainTime(
      withinDay(roundNanoseconds(BigInt(time), unitNanoseconds(index) * BigInt(increment), mode)),
    );
  }
  toString(options: Readonly<Temporal.PlainTimeToStringOptions> | undefined = undefined): string {
    const time = this.#time;
    if (options !== undefined) requireOptions(options);
    const digits = fractionalSecondDigits(options?.fractionalSecondDigits);
    const mode = roundingMode(options?.roundingMode);
    const precision = secondsStringPrecision(options?.smallestUnit, digits);
    const increment =
      precision === -2 ? 60000000000n : BigInt(precision < 0 ? 1 : 10 ** (9 - precision));
    return formatPlainTime(withinDay(roundNanoseconds(BigInt(time), increment, mode)), precision);
  }
  toLocaleString(
    locales: Intl.LocalesArgument = undefined,
    options: Readonly<Intl.DateTimeFormatOptions> | undefined = undefined,
    source: TimeLocaleSource | undefined = undefined,
  ): string {
    this.#time;
    if (source === undefined) return formatPlainTime(this.#time);
    return source.formatDateTime(
      1,
      Math.floor(this.#time / 1e6),
      "iso8601",
      locales,
      options,
      undefined,
    );
  }
  toJSON(): string {
    return formatPlainTime(this.#time);
  }
  valueOf(): never {
    throw new TypeError("Temporal.PlainTime cannot be converted to a primitive value");
  }
}
