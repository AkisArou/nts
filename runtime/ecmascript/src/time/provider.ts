// Backend primitives only. ECMAScript balancing, clipping, disambiguation and
// option/error behavior belong to shared algorithms, not these adapters.
export interface TimeZoneRules {
  readonly id: string;
  offsetMilliseconds(epochMilliseconds: number): number;
  // ICU's former/latter interpretations at a discontinuity. Shared code decides
  // whether that discontinuity is a gap or overlap and which instant to use.
  localOffsetMilliseconds(localMilliseconds: number, former: boolean): number;
  transition(epochMilliseconds: number, forward: boolean): number | null;
}

export interface TimeHost {
  nowMilliseconds(): number;
  defaultTimeZone(): TimeZoneRules;
}

export class FixedTimeZone implements TimeZoneRules {
  readonly id: string;
  readonly offset: number;
  constructor(id: string, offsetMilliseconds: number) {
    this.id = id;
    this.offset = offsetMilliseconds;
  }
  offsetMilliseconds(_epochMilliseconds: number): number {
    return this.offset;
  }
  localOffsetMilliseconds(_localMilliseconds: number, _former: boolean): number {
    return this.offset;
  }
  transition(_epochMilliseconds: number, _forward: boolean): number | null {
    return null;
  }
}

export const UTC = new FixedTimeZone("UTC", 0);

export function localTime(epochMilliseconds: number, zone: TimeZoneRules): number {
  return epochMilliseconds + zone.offsetMilliseconds(epochMilliseconds);
}

export function utcTime(localMilliseconds: number, zone: TimeZoneRules): number {
  if (!Number.isFinite(localMilliseconds)) return NaN;
  return localMilliseconds - zone.localOffsetMilliseconds(localMilliseconds, true);
}

export function disambiguate(
  localMilliseconds: number,
  zone: TimeZoneRules,
  choice: NonNullable<Temporal.DisambiguationOptions["disambiguation"]>,
): number {
  const former = zone.localOffsetMilliseconds(localMilliseconds, true);
  const latter = zone.localOffsetMilliseconds(localMilliseconds, false);
  if (former === latter) return localMilliseconds - former;
  if (choice === "reject") throw new RangeError("Ambiguous local time");
  const first = localMilliseconds - Math.max(former, latter);
  const last = localMilliseconds - Math.min(former, latter);
  if (choice === "earlier") return first;
  if (choice === "later") return last;
  // Increasing offset is a gap: move forward. Decreasing offset is an overlap:
  // choose its first occurrence. This also handles transitions below one hour.
  return former < latter ? last : first;
}
