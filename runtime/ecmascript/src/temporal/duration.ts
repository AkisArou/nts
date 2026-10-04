import {
  fractionalSecondDigits,
  roundingIncrement,
  roundingMode,
  validateIncrement,
  requireOptions,
  secondsStringPrecision,
} from "./options.ts";
import {
  roundNanoseconds,
  checkTimeDuration,
  divideExact,
  floorDivide,
  unitNanoseconds,
} from "./exact.ts";
export { unitNanoseconds } from "./exact.ts";
import type { RoundingMode } from "./exact.ts";
import { PlainDate } from "./plain-date.ts";
import { checkDateDay, addISODate } from "./iso-date.ts";
import { checkDateTime, roundISODateTimeDifference } from "./iso-date-time.ts";
import {
  relativePlainDate,
  relativeISODuration,
  relativeISOCalendarTotal,
} from "./relative-iso.ts";
import { pad } from "../date/format.ts";
import {
  NS_PER_DAY,
  NS_PER_HOUR,
  NS_PER_MICROSECOND,
  NS_PER_MILLISECOND,
  NS_PER_MINUTE,
  NS_PER_SECOND,
} from "./exact.ts";

// One object owns the validated fields and their exact normalized time. The
// cached time is derived from the public binary64 integers, never from a more
// precise hidden input that could disagree with the getters.
// Public inputs use the standard types and object results name this value class.
// Localized formatting and intrinsic metadata remain pending integration.
export class Duration {
  readonly #years: number;
  readonly #months: number;
  readonly #weeks: number;
  readonly #days: number;
  readonly #hours: number;
  readonly #minutes: number;
  readonly #seconds: number;
  readonly #milliseconds: number;
  readonly #microseconds: number;
  readonly #nanoseconds: number;
  readonly #sign: number;
  readonly #time: bigint;

  constructor(
    years = 0,
    months = 0,
    weeks = 0,
    days = 0,
    hours = 0,
    minutes = 0,
    seconds = 0,
    milliseconds = 0,
    microseconds = 0,
    nanoseconds = 0,
  ) {
    this.#years = integer(years);
    this.#months = integer(months);
    this.#weeks = integer(weeks);
    this.#days = integer(days);
    this.#hours = integer(hours);
    this.#minutes = integer(minutes);
    this.#seconds = integer(seconds);
    this.#milliseconds = integer(milliseconds);
    this.#microseconds = integer(microseconds);
    this.#nanoseconds = integer(nanoseconds);
    let sign = 0;
    for (let index = 0; index < 10; index++) {
      const value = this.#field(index);
      const current = value < 0 ? -1 : value > 0 ? 1 : 0;
      if (current !== 0) {
        if (sign !== 0 && sign !== current) throw new RangeError("Duration has mixed signs");
        sign = current;
      }
      if (Math.abs(value) >= (index < 3 ? 4294967296 : 1e25 / Number(unitNanoseconds(index))))
        throw new RangeError("Duration field outside supported range");
    }
    const time =
      BigInt(this.#days) * NS_PER_DAY +
      BigInt(this.#hours) * NS_PER_HOUR +
      BigInt(this.#minutes) * NS_PER_MINUTE +
      BigInt(this.#seconds) * NS_PER_SECOND +
      BigInt(this.#milliseconds) * NS_PER_MILLISECOND +
      BigInt(this.#microseconds) * NS_PER_MICROSECOND +
      BigInt(this.#nanoseconds);
    this.#sign = sign;
    this.#time = checkTimeDuration(time);
  }
  static from(value: Temporal.DurationLike): Duration {
    if (!(value instanceof Duration)) return toDuration(value);
    return new Duration(
      value.#years,
      value.#months,
      value.#weeks,
      value.#days,
      value.#hours,
      value.#minutes,
      value.#seconds,
      value.#milliseconds,
      value.#microseconds,
      value.#nanoseconds,
    );
  }
  // Intrinsic snapshot for shared formatting; public getters are overridable.
  static copyFields(value: Duration, destination: Float64Array): number {
    for (let index = 0; index < 10; index++) destination[index] = value.#field(index);
    return value.#sign;
  }
  static compare(
    one: Temporal.DurationLike,
    two: Temporal.DurationLike,
    opts: Readonly<Temporal.DurationRelativeToOptions> | undefined = undefined,
  ): number {
    const a = toDuration(one);
    const b = toDuration(two);
    if (opts !== undefined) requireOptions(opts);
    const relativeTo = opts?.relativeTo;
    const relative = relativePlainDate(relativeTo);
    if (
      a.years === b.years &&
      a.months === b.months &&
      a.weeks === b.weeks &&
      a.days === b.days &&
      a.hours === b.hours &&
      a.minutes === b.minutes &&
      a.seconds === b.seconds &&
      a.milliseconds === b.milliseconds &&
      a.microseconds === b.microseconds &&
      a.nanoseconds === b.nanoseconds
    )
      return 0;
    if (relative !== undefined) {
      const day = PlainDate.epochDay(relative);
      const first = relativeISODuration(day, a.#years, a.#months, a.#weeks, a.#time);
      const last = relativeISODuration(day, b.#years, b.#months, b.#weeks, b.#time);
      return first < last ? -1 : first > last ? 1 : 0;
    }
    requireFixedDays(a);
    requireFixedDays(b);
    return a.#time < b.#time ? -1 : a.#time > b.#time ? 1 : 0;
  }
  get years(): number {
    return this.#years;
  }
  get months(): number {
    return this.#months;
  }
  get weeks(): number {
    return this.#weeks;
  }
  get days(): number {
    return this.#days;
  }
  get hours(): number {
    return this.#hours;
  }
  get minutes(): number {
    return this.#minutes;
  }
  get seconds(): number {
    return this.#seconds;
  }
  get milliseconds(): number {
    return this.#milliseconds;
  }
  get microseconds(): number {
    return this.#microseconds;
  }
  get nanoseconds(): number {
    return this.#nanoseconds;
  }
  get sign(): number {
    return this.#sign;
  }
  get blank(): boolean {
    return this.#sign === 0;
  }

  #field(index: number): number {
    if (index === 0) return this.#years;
    if (index === 1) return this.#months;
    if (index === 2) return this.#weeks;
    if (index === 3) return this.#days;
    if (index === 4) return this.#hours;
    if (index === 5) return this.#minutes;
    if (index === 6) return this.#seconds;
    if (index === 7) return this.#milliseconds;
    if (index === 8) return this.#microseconds;
    if (index === 9) return this.#nanoseconds;
    throw new RangeError("Invalid duration field");
  }
  field(index: number): number {
    return this.#field(index);
  }
  static field(value: Duration, index: number): number {
    return value.#field(index);
  }
  static timeNanoseconds(value: Duration): bigint {
    return value.#time;
  }
  timeNanoseconds(): bigint {
    return this.#time;
  }
  instantNanoseconds(): bigint {
    if (this.#years !== 0 || this.#months !== 0 || this.#weeks !== 0 || this.#days !== 0)
      throw new RangeError("Instant arithmetic requires time units");
    return this.#time;
  }
  largestUnit(): number {
    for (let index = 0; index < 9; index++) if (this.#field(index) !== 0) return index;
    return 9;
  }
  scaled(sign: number): Duration {
    return new Duration(
      this.#years * sign,
      this.#months * sign,
      this.#weeks * sign,
      this.#days * sign,
      this.#hours * sign,
      this.#minutes * sign,
      this.#seconds * sign,
      this.#milliseconds * sign,
      this.#microseconds * sign,
      this.#nanoseconds * sign,
    );
  }
  with(fields: Readonly<Temporal.DurationLikeObject>): Duration {
    return durationFields(fields, this);
  }
  negated(): Duration {
    return this.scaled(-1);
  }
  abs(): Duration {
    return this.scaled(this.#sign < 0 ? -1 : 1);
  }
  add(other: Temporal.DurationLike): Duration {
    return this.#add(other, 1);
  }
  subtract(other: Temporal.DurationLike): Duration {
    return this.#add(other, -1);
  }
  #add(value: Temporal.DurationLike, sign: number): Duration {
    const other = toDuration(value);
    requireFixedDays(this);
    requireFixedDays(other);
    return balanceDuration(
      this.#time + other.#time * BigInt(sign),
      Math.min(this.largestUnit(), other.largestUnit()),
    );
  }

  round(
    value:
      | Temporal.PluralizeUnit<"day" | Temporal.TimeUnit>
      | Readonly<Temporal.DurationRoundingOptions>,
  ): Duration {
    const time = this.#time;
    const existingLargest = this.largestUnit();
    if (typeof value === "string") {
      const smallest = durationUnitIndex(value);
      requireFixedDays(this);
      return roundDuration(time, smallest, Math.min(existingLargest, smallest), 1, "halfExpand");
    }
    requireOptions(value);
    const rawLargest = value.largestUnit;
    if (typeof rawLargest === "symbol")
      throw new TypeError("Temporal string options reject Symbols");
    const largestText = rawLargest === undefined ? "auto" : String(rawLargest);
    const largest = largestText === "auto" ? -1 : durationUnitIndex(largestText);
    const relativeTo = value.relativeTo;
    const relative = relativePlainDate(relativeTo);
    const increment = roundingIncrement(value.roundingIncrement);
    const rawMode = value.roundingMode;
    const mode = roundingMode(rawMode === undefined ? "halfExpand" : rawMode);
    const rawSmallest = value.smallestUnit;
    const smallest = rawSmallest === undefined ? 9 : durationUnitIndex(rawSmallest);
    if (rawLargest === undefined && rawSmallest === undefined)
      throw new RangeError("A rounding unit is required");
    const actualLargest = largest < 0 ? Math.min(existingLargest, smallest) : largest;
    if (actualLargest > smallest) throw new RangeError("Invalid duration unit order");
    if (smallest >= 4) validateIncrement(smallest, increment);
    if (increment > 1 && smallest <= 3 && actualLargest !== smallest)
      throw new RangeError("Calendar increments require matching largest and smallest units");
    if (relative !== undefined) {
      const day = PlainDate.epochDay(relative);
      const days = floorDivide(time, NS_PER_DAY);
      const targetDay = addISODate(
        day,
        this.years,
        this.months,
        this.weeks,
        Number(days),
        "constrain",
      );
      const targetTime = Number(time - days * NS_PER_DAY);
      if (day === targetDay && targetTime === 0) return new Duration();
      checkDateTime(day, 0);
      checkDateTime(targetDay, targetTime);
      return roundISODateTimeDifference(
        day,
        0,
        targetDay,
        targetTime,
        actualLargest,
        smallest,
        increment,
        mode,
      );
    }
    requireFixedDays(this, relativeTo);
    return roundDuration(time, smallest, actualLargest, increment, mode);
  }
  total(
    value:
      | Temporal.PluralizeUnit<"day" | Temporal.TimeUnit>
      | Readonly<Temporal.DurationTotalOptions>,
  ): number {
    const time = this.#time;
    if (typeof value === "string") {
      const unit = durationUnitIndex(value);
      requireFixedDays(this);
      return durationTotal(time, unit);
    }
    requireOptions(value);
    const relativeTo = value.relativeTo;
    const relative = relativePlainDate(relativeTo);
    const rawUnit = value.unit;
    if (rawUnit === undefined) throw new RangeError("A total unit is required");
    const unit = durationUnitIndex(rawUnit);
    if (relative !== undefined) {
      const day = PlainDate.epochDay(relative);
      const nanoseconds = relativeISODuration(day, this.#years, this.#months, this.#weeks, time);
      checkDateDay(day + Number(floorDivide(nanoseconds, NS_PER_DAY)));
      return unit < 3
        ? relativeISOCalendarTotal(day, nanoseconds, unit)
        : durationTotal(nanoseconds, unit);
    }
    requireFixedDays(this);
    return durationTotal(time, unit);
  }
  toString(opts: Readonly<Temporal.DurationToStringOptions> | undefined = undefined): string {
    const time = this.#time;
    if (opts !== undefined) requireOptions(opts);
    const digits = fractionalSecondDigits(opts?.fractionalSecondDigits);
    const mode = roundingMode(opts?.roundingMode);
    const precision = secondsStringPrecision(opts?.smallestUnit, digits);
    if (precision === -2)
      throw new RangeError("Duration strings require second precision or smaller");
    if (precision < 0 || precision === 9) return formatDuration(this, precision);
    const rounded = roundNanoseconds(time, BigInt(10 ** (9 - precision)), mode);
    const balanced = balanceDuration(rounded, Math.min(6, Math.max(3, this.largestUnit())));
    return formatDuration(
      new Duration(
        this.#years,
        this.#months,
        this.#weeks,
        balanced.days,
        balanced.hours,
        balanced.minutes,
        balanced.seconds,
        balanced.milliseconds,
        balanced.microseconds,
        balanced.nanoseconds,
      ),
      precision,
    );
  }
  toJSON(): string {
    return formatDuration(this);
  }
  valueOf(): never {
    throw new TypeError("Temporal.Duration cannot be converted to a primitive value");
  }
}

function integer(value: number): number {
  if (typeof value === "bigint" || typeof value === "symbol")
    throw new TypeError("Duration numeric fields reject BigInts and Symbols");
  const number = Number(value);
  if (!Number.isFinite(number) || !Number.isInteger(number))
    throw new RangeError("Duration fields must be integral");
  return number === 0 ? 0 : number;
}
function durationFields(
  value: Readonly<Temporal.DurationLikeObject>,
  previous?: Duration,
): Duration {
  // Read and independently validate each named field in specification order.
  // There is no temporary array or run-time string-key lookup.
  const rawDays = value.days;
  const days = rawDays === undefined ? (previous?.days ?? 0) : integer(rawDays);
  const rawHours = value.hours;
  const hours = rawHours === undefined ? (previous?.hours ?? 0) : integer(rawHours);
  const rawMicroseconds = value.microseconds;
  const microseconds =
    rawMicroseconds === undefined ? (previous?.microseconds ?? 0) : integer(rawMicroseconds);
  const rawMilliseconds = value.milliseconds;
  const milliseconds =
    rawMilliseconds === undefined ? (previous?.milliseconds ?? 0) : integer(rawMilliseconds);
  const rawMinutes = value.minutes;
  const minutes = rawMinutes === undefined ? (previous?.minutes ?? 0) : integer(rawMinutes);
  const rawMonths = value.months;
  const months = rawMonths === undefined ? (previous?.months ?? 0) : integer(rawMonths);
  const rawNanoseconds = value.nanoseconds;
  const nanoseconds =
    rawNanoseconds === undefined ? (previous?.nanoseconds ?? 0) : integer(rawNanoseconds);
  const rawSeconds = value.seconds;
  const seconds = rawSeconds === undefined ? (previous?.seconds ?? 0) : integer(rawSeconds);
  const rawWeeks = value.weeks;
  const weeks = rawWeeks === undefined ? (previous?.weeks ?? 0) : integer(rawWeeks);
  const rawYears = value.years;
  const years = rawYears === undefined ? (previous?.years ?? 0) : integer(rawYears);
  if (
    rawDays === undefined &&
    rawHours === undefined &&
    rawMicroseconds === undefined &&
    rawMilliseconds === undefined &&
    rawMinutes === undefined &&
    rawMonths === undefined &&
    rawNanoseconds === undefined &&
    rawSeconds === undefined &&
    rawWeeks === undefined &&
    rawYears === undefined
  )
    throw new TypeError("Duration requires a field");
  return new Duration(
    years,
    months,
    weeks,
    days,
    hours,
    minutes,
    seconds,
    milliseconds,
    microseconds,
    nanoseconds,
  );
}
export function toDuration(value: Temporal.DurationLike): Duration {
  if (typeof value === "string") return parseDuration(value);
  if (value instanceof Duration) return value;
  return durationFields(value);
}
function requireFixedDays(
  value: Duration,
  relativeTo?: Temporal.DurationRelativeToOptions["relativeTo"],
): void {
  if (relativeTo !== undefined || value.years !== 0 || value.months !== 0 || value.weeks !== 0)
    throw new RangeError("Calendar duration arithmetic requires the relative-date adapter");
}
export function durationUnitIndex(unit: string): number {
  if (typeof unit === "symbol") throw new TypeError("Temporal string options reject Symbols");
  unit = String(unit);
  if (unit === "year" || unit === "years") return 0;
  if (unit === "month" || unit === "months") return 1;
  if (unit === "week" || unit === "weeks") return 2;
  if (unit === "day" || unit === "days") return 3;
  return timeUnitIndex(unit);
}
function roundDuration(
  time: bigint,
  smallest: number,
  largest: number,
  increment: number,
  mode: RoundingMode,
): Duration {
  if (largest > smallest) throw new RangeError("Invalid duration unit order");
  if (largest < 3 || smallest < 3)
    throw new RangeError("Calendar rounding requires a relative date");
  validateIncrement(smallest, increment);
  return balanceDuration(
    roundNanoseconds(time, unitNanoseconds(smallest) * BigInt(increment), mode),
    largest,
  );
}

// Round the mathematical quotient once to binary64. Adding separately rounded
// whole/fraction values or converting nanoseconds to Number first double-rounds
// some totals. All scaled intermediates here need at most ~100 bits.
export function durationTotal(nanoseconds: bigint, unit: number): number {
  return divideExact(nanoseconds, unitNanoseconds(unit));
}

export function timeUnitIndex(unit: string): number {
  if (typeof unit === "symbol") throw new TypeError("Temporal string options reject Symbols");
  unit = String(unit);
  if (unit === "hour" || unit === "hours") return 4;
  if (unit === "minute" || unit === "minutes") return 5;
  if (unit === "second" || unit === "seconds") return 6;
  if (unit === "millisecond" || unit === "milliseconds") return 7;
  if (unit === "microsecond" || unit === "microseconds") return 8;
  if (unit === "nanosecond" || unit === "nanoseconds") return 9;
  throw new RangeError("Invalid time unit");
}

// Divide in bigint before converting each result field to Number. This avoids
// rounding the entire duration before its nanosecond remainder is computed.
export function balanceDuration(
  value: bigint,
  largestUnit: number,
  years = 0,
  months = 0,
  weeks = 0,
  dateDays = 0,
): Duration {
  let remainder = value;
  let days = dateDays;
  let hours = 0;
  let minutes = 0;
  let seconds = 0;
  let milliseconds = 0;
  let microseconds = 0;
  if (largestUnit <= 3) {
    days += Number(remainder / NS_PER_DAY);
    remainder %= NS_PER_DAY;
  }
  if (largestUnit <= 4) {
    hours = Number(remainder / NS_PER_HOUR);
    remainder %= NS_PER_HOUR;
  }
  if (largestUnit <= 5) {
    minutes = Number(remainder / NS_PER_MINUTE);
    remainder %= NS_PER_MINUTE;
  }
  if (largestUnit <= 6) {
    seconds = Number(remainder / NS_PER_SECOND);
    remainder %= NS_PER_SECOND;
  }
  if (largestUnit <= 7) {
    milliseconds = Number(remainder / NS_PER_MILLISECOND);
    remainder %= NS_PER_MILLISECOND;
  }
  if (largestUnit <= 8) {
    microseconds = Number(remainder / NS_PER_MICROSECOND);
    remainder %= NS_PER_MICROSECOND;
  }
  return new Duration(
    years,
    months,
    weeks,
    days,
    hours,
    minutes,
    seconds,
    milliseconds,
    microseconds,
    Number(remainder),
  );
}

export function parseDuration(input: string): Duration {
  let index = 0;
  let sign = 1;
  if (input.charAt(index) === "-") {
    sign = -1;
    index++;
  } else if (input.charAt(index) === "+") index++;
  if (input.charAt(index++).toUpperCase() !== "P") throw new RangeError("Invalid duration string");
  let time = false;
  let previous = -1;
  let seen = false;
  let timeSeen = false;
  let fractional = false;
  let years = 0;
  let months = 0;
  let weeks = 0;
  let days = 0;
  let hours = 0;
  let minutes = 0;
  let seconds = 0;
  let subsecond = 0;
  while (index < input.length) {
    if (input.charAt(index).toUpperCase() === "T") {
      if (time) throw new RangeError("Invalid duration string");
      time = true;
      index++;
      continue;
    }
    if (fractional) throw new RangeError("Only the last time field can be fractional");
    const start = index;
    while (input.charCodeAt(index) >= 48 && input.charCodeAt(index) <= 57) index++;
    if (start === index) throw new RangeError("Invalid duration string");
    const value = Number(input.slice(start, index));
    let fraction = 0;
    if (input.charAt(index) === "." || input.charAt(index) === ",") {
      index++;
      let count = 0;
      while (input.charCodeAt(index) >= 48 && input.charCodeAt(index) <= 57) {
        fraction = fraction * 10 + input.charCodeAt(index++) - 48;
        if (++count > 9) throw new RangeError("Too many duration fraction digits");
      }
      if (count === 0 || !time) throw new RangeError("Invalid duration fraction");
      fraction *= 10 ** (9 - count);
      fractional = true;
    }
    const designator = input.charAt(index++).toUpperCase();
    let unit = -1;
    if (!time) {
      if (designator === "Y") unit = 0;
      else if (designator === "M") unit = 1;
      else if (designator === "W") unit = 2;
      else if (designator === "D") unit = 3;
    } else {
      if (designator === "H") unit = 4;
      else if (designator === "M") unit = 5;
      else if (designator === "S") unit = 6;
    }
    if (unit < 0 || unit <= previous) throw new RangeError("Invalid duration field order");
    previous = unit;
    seen = true;
    if (time) timeSeen = true;
    if (unit === 0) years = value;
    else if (unit === 1) months = value;
    else if (unit === 2) weeks = value;
    else if (unit === 3) days = value;
    else if (unit === 4) hours = value;
    else if (unit === 5) minutes = value;
    else seconds = value;
    if (fractional) {
      // At most nine fractional digits: multiplying their integer numerator
      // by 3600/60 stays exactly representable in Number, without decimal FP.
      let nano = fraction * (unit === 4 ? 3600 : unit === 5 ? 60 : 1);
      if (unit === 4) {
        minutes = Math.floor(nano / 60000000000);
        nano %= 60000000000;
      }
      if (unit <= 5) {
        seconds = Math.floor(nano / 1000000000);
        nano %= 1000000000;
      }
      subsecond = nano;
    }
  }
  if (!seen || (time && !timeSeen)) throw new RangeError("Empty duration string");
  return new Duration(
    years * sign,
    months * sign,
    weeks * sign,
    days * sign,
    hours * sign,
    minutes * sign,
    seconds * sign,
    Math.floor(subsecond / 1000000) * sign,
    (Math.floor(subsecond / 1000) % 1000) * sign,
    (subsecond % 1000) * sign,
  );
}

export function formatDuration(duration: Duration, digits = -1): string {
  const sign = duration.sign < 0 ? -1 : 1;
  let text = duration.sign < 0 ? "-P" : "P";
  if (duration.years !== 0) text += String(duration.years * sign) + "Y";
  if (duration.months !== 0) text += String(duration.months * sign) + "M";
  if (duration.weeks !== 0) text += String(duration.weeks * sign) + "W";
  if (duration.days !== 0) text += String(duration.days * sign) + "D";
  const subsecond =
    (BigInt(duration.milliseconds) * NS_PER_MILLISECOND +
      BigInt(duration.microseconds) * NS_PER_MICROSECOND +
      BigInt(duration.nanoseconds)) *
    BigInt(sign);
  const seconds = BigInt(duration.seconds * sign) + subsecond / NS_PER_SECOND;
  let fraction = pad(Number(subsecond % NS_PER_SECOND), 9);
  if (digits < 0) {
    let end = fraction.length;
    while (end > 0 && fraction.charAt(end - 1) === "0") end--;
    fraction = fraction.slice(0, end);
  } else fraction = fraction.slice(0, digits);
  const showSecond = seconds !== 0n || fraction.length > 0 || digits >= 0 || duration.sign === 0;
  if (duration.hours !== 0 || duration.minutes !== 0 || showSecond) {
    text += "T";
    if (duration.hours !== 0) text += String(duration.hours * sign) + "H";
    if (duration.minutes !== 0) text += String(duration.minutes * sign) + "M";
    if (showSecond) text += String(seconds) + (fraction.length > 0 ? "." + fraction : "") + "S";
  }
  return text;
}
