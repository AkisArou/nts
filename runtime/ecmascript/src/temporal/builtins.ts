import { checkInstant, epochMilliseconds, NS_PER_MILLISECOND, roundNanoseconds } from "./exact.ts";
import { formatInstant, parseInstant, roundInstant } from "./instant.ts";
import {
  balanceDuration,
  Duration,
  toDuration,
  timeUnitIndex,
  unitNanoseconds,
} from "./duration.ts";
import {
  fractionalSecondDigits,
  roundingIncrement,
  roundingMode,
  validateIncrement,
  requireOptions,
  secondsStringPrecision,
} from "./options.ts";
import type { NtsDate } from "../date/builtins.ts";
import type { WithResult } from "../contract.ts";

export { Duration } from "./duration.ts";
export { PlainTime } from "./plain-time.ts";
export { PlainDate } from "./plain-date.ts";

function toInstant(value: Temporal.InstantLike | Instant): bigint {
  if (typeof value === "string") return parseInstant(value);
  if (value === null || typeof value !== "object")
    throw new TypeError("Instant requires an instant, zoned date-time or string");
  const epoch = value.epochNanoseconds;
  if (typeof epoch !== "bigint")
    throw new TypeError("Instant requires an instant or zoned date-time");
  return checkInstant(epoch);
}
function difference(
  epoch: bigint,
  other: Temporal.InstantLike | Instant,
  opts: Readonly<Temporal.RoundingOptionsWithLargestUnit<Temporal.TimeUnit>>,
  since: boolean,
): Duration {
  const target = toInstant(other);
  requireOptions(opts);
  const largestOption = opts.largestUnit;
  if (typeof largestOption === "symbol")
    throw new TypeError("Temporal string options reject Symbols");
  const largestText = largestOption === undefined ? "auto" : String(largestOption);
  const increment = roundingIncrement(opts.roundingIncrement);
  const mode = roundingMode(opts.roundingMode);
  const smallestOption = opts.smallestUnit;
  const smallest = timeUnitIndex(smallestOption === undefined ? "nanosecond" : smallestOption);
  const largest = largestText === "auto" ? Math.min(6, smallest) : timeUnitIndex(largestText);
  if (largest > smallest) throw new RangeError("Invalid instant difference unit order");
  validateIncrement(smallest, increment);
  const delta = since ? epoch - target : target - epoch;
  return balanceDuration(
    roundNanoseconds(delta, unitNanoseconds(smallest) * BigInt(increment), mode),
    largest,
  );
}

export class Instant implements WithResult<
  WithResult<
    Omit<Temporal.Instant, "toLocaleString" | "toZonedDateTimeISO" | typeof Symbol.toStringTag>,
    Temporal.Duration,
    Duration
  >,
  Temporal.Instant,
  Instant
> {
  readonly #epochNanoseconds: bigint;
  constructor(epochNanoseconds: bigint) {
    if (typeof epochNanoseconds !== "bigint")
      throw new TypeError("Instant epoch nanoseconds must be a BigInt");
    this.#epochNanoseconds = checkInstant(epochNanoseconds);
  }
  static from(value: Temporal.InstantLike | Instant): Instant {
    return new Instant(toInstant(value));
  }
  static fromEpochMilliseconds(milliseconds: number): Instant {
    if (typeof milliseconds === "bigint" || typeof milliseconds === "symbol")
      throw new TypeError("Epoch milliseconds must be a Number");
    milliseconds = Number(milliseconds);
    if (!Number.isInteger(milliseconds) || Math.abs(milliseconds) > 8640000000000000)
      throw new RangeError("Epoch milliseconds must be integral and within range");
    return new Instant(BigInt(milliseconds) * NS_PER_MILLISECOND);
  }
  static fromEpochNanoseconds(value: bigint): Instant {
    return new Instant(value);
  }
  static compare(one: Temporal.InstantLike | Instant, two: Temporal.InstantLike | Instant): number {
    const a = toInstant(one);
    const b = toInstant(two);
    return a < b ? -1 : a > b ? 1 : 0;
  }
  get epochMilliseconds(): number {
    return epochMilliseconds(this.#epochNanoseconds);
  }
  // Internal-slot access for Intl, independent of overridable public getters.
  static epochMilliseconds(value: Instant): number {
    return epochMilliseconds(value.#epochNanoseconds);
  }
  get epochNanoseconds(): bigint {
    return this.#epochNanoseconds;
  }
  add(value: Temporal.DurationLike): Instant {
    return new Instant(this.#epochNanoseconds + toDuration(value).instantNanoseconds());
  }
  subtract(value: Temporal.DurationLike): Instant {
    return new Instant(this.#epochNanoseconds - toDuration(value).instantNanoseconds());
  }
  until(
    other: Temporal.InstantLike | Instant,
    opts: Readonly<Temporal.RoundingOptionsWithLargestUnit<Temporal.TimeUnit>> = {},
  ): Duration {
    return difference(this.#epochNanoseconds, other, opts, false);
  }
  since(
    other: Temporal.InstantLike | Instant,
    opts: Readonly<Temporal.RoundingOptionsWithLargestUnit<Temporal.TimeUnit>> = {},
  ): Duration {
    return difference(this.#epochNanoseconds, other, opts, true);
  }
  equals(other: Temporal.InstantLike | Instant): boolean {
    return this.#epochNanoseconds === toInstant(other);
  }
  round(
    value:
      | Temporal.PluralizeUnit<Temporal.TimeUnit>
      | Readonly<Temporal.RoundingOptions<Temporal.TimeUnit>>,
  ): Instant {
    if (typeof value === "string")
      return new Instant(roundInstant(this.#epochNanoseconds, value, 1, "halfExpand"));
    requireOptions(value);
    const increment = roundingIncrement(value.roundingIncrement);
    const modeOption = value.roundingMode;
    const mode = roundingMode(modeOption === undefined ? "halfExpand" : modeOption);
    const unit = value.smallestUnit;
    if (unit === undefined) throw new RangeError("smallestUnit required");
    return new Instant(roundInstant(this.#epochNanoseconds, unit, increment, mode));
  }
  toString(opts: Readonly<Temporal.InstantToStringOptions> = {}): string {
    requireOptions(opts);
    const digits = fractionalSecondDigits(opts.fractionalSecondDigits);
    const mode = roundingMode(opts.roundingMode);
    const precision = secondsStringPrecision(opts.smallestUnit, digits);
    if (opts.timeZone !== undefined)
      throw new RangeError("Instant time-zone formatting requires the zone adapter");
    const minutes = precision === -2;
    const increment = minutes ? 60000000000n : BigInt(precision < 0 ? 1 : 10 ** (9 - precision));
    const result = formatInstant(
      roundInstant(this.#epochNanoseconds, "nanosecond", Number(increment), mode),
      minutes ? 0 : precision,
    );
    return minutes ? result.slice(0, -4) + "Z" : result;
  }
  toJSON(): string {
    return formatInstant(this.#epochNanoseconds);
  }
  valueOf(): never {
    throw new TypeError("Temporal.Instant cannot be converted to a primitive value");
  }
}

// This optional bridge is reached from Temporal integration, so importing Date
// arithmetic does not initialize Temporal or pull in nanosecond helpers.
export function dateToInstant(date: NtsDate): Instant {
  return Instant.fromEpochMilliseconds(date.getTime());
}
