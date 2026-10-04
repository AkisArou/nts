import type { ResolvedTimeZone, TimeZoneSource } from "../time/zone-data.ts";
import { INSTANT_LIMIT, NS_PER_DAY, floorDivide } from "./exact.ts";
import { localNanoseconds } from "./zoned-time.ts";
import { resolveTimeZone } from "./zone-like.ts";
import { Instant } from "./instant-object.ts";
import { ZonedDateTime } from "./zoned-date-time.ts";
import { PlainDate, createPlainDate } from "./plain-date.ts";
import { PlainTime, createPlainTime } from "./plain-time.ts";
import { PlainDateTime, createPlainDateTime } from "./plain-date-time.ts";

// One environment owns the clock and current canonical default-zone query.
// Clock samples retain their full precision and are clamped to Instant's range.
// Each operation samples once and constructs its result without intermediate
// Temporal values or prepared date/time records.
export class NtsNow {
  readonly #clock: () => bigint;
  readonly #defaultIdentifier: () => string;
  readonly #source: TimeZoneSource | undefined;

  constructor(
    nowNanoseconds: () => bigint,
    defaultTimeZoneIdentifier: () => string,
    source: TimeZoneSource | undefined = undefined,
  ) {
    this.#clock = nowNanoseconds;
    this.#defaultIdentifier = defaultTimeZoneIdentifier;
    this.#source = source;
  }
  #epoch(): bigint {
    const epoch = this.#clock();
    return epoch < -INSTANT_LIMIT ? -INSTANT_LIMIT : epoch > INSTANT_LIMIT ? INSTANT_LIMIT : epoch;
  }
  #zone(
    value: Temporal.TimeZoneLike | ZonedDateTime<ResolvedTimeZone> | undefined,
  ): ResolvedTimeZone {
    return resolveTimeZone(value === undefined ? this.#defaultIdentifier() : value, this.#source);
  }
  #local(value: Temporal.TimeZoneLike | ZonedDateTime<ResolvedTimeZone> | undefined): bigint {
    const zone = this.#zone(value);
    return localNanoseconds(this.#epoch(), zone);
  }
  timeZoneId(): string {
    return this.#defaultIdentifier();
  }
  instant(): Instant {
    return new Instant(this.#epoch());
  }
  zonedDateTimeISO(
    timeZone: Temporal.TimeZoneLike | ZonedDateTime<ResolvedTimeZone> | undefined = undefined,
  ): ZonedDateTime<ResolvedTimeZone> {
    const zone = this.#zone(timeZone);
    return new ZonedDateTime(this.#epoch(), zone);
  }
  plainDateTimeISO(
    timeZone: Temporal.TimeZoneLike | ZonedDateTime<ResolvedTimeZone> | undefined = undefined,
  ): PlainDateTime {
    const local = this.#local(timeZone);
    const day = floorDivide(local, NS_PER_DAY);
    return createPlainDateTime(Number(day), Number(local - day * NS_PER_DAY));
  }
  plainDateISO(
    timeZone: Temporal.TimeZoneLike | ZonedDateTime<ResolvedTimeZone> | undefined = undefined,
  ): PlainDate {
    return createPlainDate(Number(floorDivide(this.#local(timeZone), NS_PER_DAY)));
  }
  plainTimeISO(
    timeZone: Temporal.TimeZoneLike | ZonedDateTime<ResolvedTimeZone> | undefined = undefined,
  ): PlainTime {
    const local = this.#local(timeZone);
    const day = floorDivide(local, NS_PER_DAY);
    return createPlainTime(Number(local - day * NS_PER_DAY));
  }
}
