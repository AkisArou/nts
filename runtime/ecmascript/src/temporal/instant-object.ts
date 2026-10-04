import type { TimeLocaleSource } from "../time/locale-source.ts";
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
  temporalUnit,
} from "./options.ts";
import type { TimeZoneSource } from "../time/zone-data.ts";
import { resolveTimeZone } from "./zone-like.ts";
import { ZonedDateTime } from "./zoned-date-time.ts";
import type { ResolvedTimeZone } from "../time/zone-data.ts";

function toInstant(
  value: Temporal.InstantLike | Instant | ZonedDateTime<ResolvedTimeZone>,
): bigint {
  if (typeof value === "string") return parseInstant(value);
  if (value instanceof Instant) return Instant.nanoseconds(value);
  if (value instanceof ZonedDateTime) return ZonedDateTime.epochNanoseconds(value);
  if (value === null || (typeof value !== "object" && typeof value !== "function"))
    throw new TypeError("Instant requires an instant, zoned date-time or string");
  return parseInstant(String(value));
}
function difference(
  epoch: bigint,
  other: Temporal.InstantLike | Instant | ZonedDateTime<ResolvedTimeZone>,
  opts: Readonly<Temporal.RoundingOptionsWithLargestUnit<Temporal.TimeUnit>> | undefined,
  since: boolean,
): Duration {
  const target = toInstant(other);
  if (opts !== undefined) requireOptions(opts);
  const largestOption = opts?.largestUnit;
  if (typeof largestOption === "symbol")
    throw new TypeError("Temporal string options reject Symbols");
  const largestText = largestOption === undefined ? "auto" : String(largestOption);
  const increment = roundingIncrement(opts?.roundingIncrement);
  const mode = roundingMode(opts?.roundingMode);
  const smallestOption = opts?.smallestUnit;
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

export class Instant {
  readonly #epochNanoseconds: bigint;
  constructor(epochNanoseconds: bigint) {
    if (typeof epochNanoseconds !== "bigint")
      throw new TypeError("Instant epoch nanoseconds must be a BigInt");
    this.#epochNanoseconds = checkInstant(epochNanoseconds);
  }
  static from(value: Temporal.InstantLike | Instant | ZonedDateTime<ResolvedTimeZone>): Instant {
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
  static compare(
    one: Temporal.InstantLike | Instant | ZonedDateTime<ResolvedTimeZone>,
    two: Temporal.InstantLike | Instant | ZonedDateTime<ResolvedTimeZone>,
  ): number {
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
  static nanoseconds(value: Instant): bigint {
    return value.#epochNanoseconds;
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
    other: Temporal.InstantLike | Instant | ZonedDateTime<ResolvedTimeZone>,
    opts:
      | Readonly<Temporal.RoundingOptionsWithLargestUnit<Temporal.TimeUnit>>
      | undefined = undefined,
  ): Duration {
    return difference(this.#epochNanoseconds, other, opts, false);
  }
  since(
    other: Temporal.InstantLike | Instant | ZonedDateTime<ResolvedTimeZone>,
    opts:
      | Readonly<Temporal.RoundingOptionsWithLargestUnit<Temporal.TimeUnit>>
      | undefined = undefined,
  ): Duration {
    return difference(this.#epochNanoseconds, other, opts, true);
  }
  equals(other: Temporal.InstantLike | Instant | ZonedDateTime<ResolvedTimeZone>): boolean {
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
    const unit = temporalUnit(value.smallestUnit);
    if (unit === undefined) throw new RangeError("smallestUnit required");
    return new Instant(roundInstant(this.#epochNanoseconds, unit, increment, mode));
  }
  toString(
    opts: Readonly<Temporal.InstantToStringOptions> | undefined = undefined,
    timeZones: TimeZoneSource | undefined = undefined,
  ): string {
    if (opts !== undefined) requireOptions(opts);
    const digits = fractionalSecondDigits(opts?.fractionalSecondDigits);
    const mode = roundingMode(opts?.roundingMode);
    const smallestUnit = temporalUnit(opts?.smallestUnit);
    const timeZone = opts?.timeZone;
    const precision = secondsStringPrecision(smallestUnit, digits);
    const zone = timeZone === undefined ? undefined : resolveTimeZone(timeZone, timeZones);
    const minutes = precision === -2;
    const increment = minutes ? 60000000000n : BigInt(precision < 0 ? 1 : 10 ** (9 - precision));
    return formatInstant(
      roundInstant(this.#epochNanoseconds, "nanosecond", Number(increment), mode),
      precision,
      zone,
    );
  }
  toLocaleString(
    locales: Intl.LocalesArgument = undefined,
    options: Readonly<Intl.DateTimeFormatOptions> | undefined = undefined,
    source: TimeLocaleSource | undefined = undefined,
  ): string {
    this.#epochNanoseconds;
    if (source === undefined) return formatInstant(this.#epochNanoseconds);
    return source.formatDateTime(
      0,
      epochMilliseconds(this.#epochNanoseconds),
      "iso8601",
      locales,
      options,
      undefined,
    );
  }
  toJSON(): string {
    return formatInstant(this.#epochNanoseconds);
  }
  toZonedDateTimeISO(
    value: Temporal.TimeZoneLike | ZonedDateTime<ResolvedTimeZone>,
    source: TimeZoneSource | undefined = undefined,
  ): ZonedDateTime<ResolvedTimeZone> {
    const epoch = this.#epochNanoseconds;
    return new ZonedDateTime(epoch, resolveTimeZone(value, source));
  }
  valueOf(): never {
    throw new TypeError("Temporal.Instant cannot be converted to a primitive value");
  }
}
