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
} from "./options.ts";
import type { NtsDate } from "../date/builtins.ts";
import type { WithResult } from "./contract.ts";

export { Duration } from "./duration.ts";

function toInstant(value: Temporal.InstantLike | Instant): bigint {
  return typeof value === "string" ? parseInstant(value) : value.epochNanoseconds;
}
function difference(
  epoch: bigint,
  other: Temporal.InstantLike | Instant,
  opts: Readonly<Temporal.RoundingOptionsWithLargestUnit<Temporal.TimeUnit>>,
  since: boolean,
): Duration {
  const target = toInstant(other);
  const largestText = opts.largestUnit ?? "auto";
  const increment = roundingIncrement(opts.roundingIncrement ?? 1);
  const mode = roundingMode(opts.roundingMode ?? "trunc");
  const smallest = timeUnitIndex(opts.smallestUnit ?? "nanosecond");
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
    this.#epochNanoseconds = checkInstant(epochNanoseconds);
  }
  static from(value: Temporal.InstantLike | Instant): Instant {
    return new Instant(toInstant(value));
  }
  static fromEpochMilliseconds(milliseconds: number): Instant {
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
    const increment = roundingIncrement(value.roundingIncrement ?? 1);
    const mode = roundingMode(value.roundingMode ?? "halfExpand");
    const unit = value.smallestUnit;
    if (unit === undefined) throw new RangeError("smallestUnit required");
    return new Instant(roundInstant(this.#epochNanoseconds, unit, increment, mode));
  }
  toString(opts: Readonly<Temporal.InstantToStringOptions> = {}): string {
    let digits = fractionalSecondDigits(opts.fractionalSecondDigits ?? "auto");
    const mode = roundingMode(opts.roundingMode ?? "trunc");
    const precision = opts.smallestUnit;
    if (opts.timeZone !== undefined)
      throw new RangeError("Instant time-zone formatting requires the zone adapter");
    let unit: Temporal.PluralizeUnit<Temporal.TimeUnit> = "nanosecond";
    let increment = 1;
    const minutes = precision === "minute" || precision === "minutes";
    if (precision !== undefined) {
      unit = precision;
      digits = minutes ? 0 : (timeUnitIndex(precision) - 6) * 3;
    } else if (digits >= 0) {
      unit =
        digits === 0
          ? "second"
          : digits <= 3
            ? "millisecond"
            : digits <= 6
              ? "microsecond"
              : "nanosecond";
      increment = digits === 0 ? 1 : 10 ** ((digits <= 3 ? 3 : digits <= 6 ? 6 : 9) - digits);
    }
    const result = formatInstant(
      roundInstant(this.#epochNanoseconds, unit, increment, mode),
      digits,
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
