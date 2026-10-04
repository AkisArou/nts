import type { TimeZoneRules } from "../time/provider.ts";
import { formatOffsetTimeZone } from "../time/offset-zone-id.ts";
import {
  checkInstant,
  epochMilliseconds,
  INSTANT_LIMIT,
  NS_PER_DAY,
  NS_PER_MILLISECOND,
  NS_PER_MINUTE,
  roundNanoseconds,
} from "./exact.ts";
import { checkDateDay } from "./iso-date.ts";
import { MS_PER_DAY } from "../date/calendar.ts";
import { formatPlainTime } from "./iso-time.ts";

function offsetMilliseconds(value: number): number {
  if (!Number.isInteger(value) || Math.abs(value) >= 86400000)
    throw new Error("Time-zone provider returned an invalid offset");
  return value;
}

export function offsetNanoseconds(epoch: bigint, zone: TimeZoneRules): bigint {
  return (
    BigInt(offsetMilliseconds(zone.offsetMilliseconds(epochMilliseconds(epoch)))) *
    NS_PER_MILLISECOND
  );
}

export function localNanoseconds(epoch: bigint, zone: TimeZoneRules): bigint {
  checkInstant(epoch);
  return epoch + offsetNanoseconds(epoch, zone);
}

function offsetMatches(milliseconds: number, supplied: bigint, matchMinutes: boolean): boolean {
  // Offsets are below 24 hours, so their nanosecond values are exact Numbers.
  // Rounding an integral millisecond offset to a minute also stays exact.
  const candidate = milliseconds * 1000000;
  const provided = Number(supplied);
  const minutes =
    Math.floor((Math.abs(milliseconds) + 30000) / 60000) * (milliseconds < 0 ? -1 : 1);
  return candidate === provided || (matchMinutes && minutes * 60000000000 === provided);
}

function checkEpochMilliseconds(milliseconds: number, fraction: number): void {
  if (
    milliseconds < -8640000000000000 ||
    milliseconds > 8640000000000000 ||
    (milliseconds === 8640000000000000 && fraction !== 0)
  )
    throw new RangeError("Instant outside supported range");
}

function epochNanoseconds(milliseconds: number, fraction = 0): bigint {
  checkEpochMilliseconds(milliseconds, fraction);
  const whole = BigInt(milliseconds) * NS_PER_MILLISECOND;
  return fraction === 0 ? whole : whole + BigInt(fraction);
}

function disambiguateGap(
  day: number,
  time: number,
  zone: TimeZoneRules,
  disambiguation: NonNullable<Temporal.DisambiguationOptions["disambiguation"]>,
  gap: number,
): bigint {
  if (gap <= 0 || gap > MS_PER_DAY)
    throw new Error("Time-zone provider returned inconsistent local offsets");
  // Shift wall time by the actual gap, then select an occurrence of the
  // shifted time. This handles non-hour transitions and a skipped date.
  const shifted = time + (disambiguation === "earlier" ? -gap : gap) * 1000000;
  const dayShift = Math.floor(shifted / 86400000000000);
  return resolveLocalDateTime(
    day + dayShift,
    shifted - dayShift * 86400000000000,
    zone,
    disambiguation === "earlier" ? "earlier" : "later",
  );
}

// ICU supplies former/latter local interpretations; shared code verifies the
// corresponding instants. There are at most two candidates in the pinned IANA
// database. Keep them as scalars, including on the common unambiguous path.
export function resolveLocalDateTime(
  day: number,
  time: number,
  zone: TimeZoneRules,
  disambiguation: NonNullable<Temporal.DisambiguationOptions["disambiguation"]>,
  offsetOption: NonNullable<Temporal.ZonedDateTimeFromOptions["offset"]> = "ignore",
  suppliedOffset: bigint = 0n,
  matchMinutes = false,
): bigint {
  checkDateDay(day);
  if (!Number.isInteger(time) || time < 0 || time >= 86400000000000)
    throw new RangeError("Local time outside supported range");
  if (offsetOption === "use")
    return checkInstant(BigInt(day) * NS_PER_DAY + BigInt(time) - suppliedOffset);
  const useOffset = offsetOption !== "ignore";
  // The entire extended local millisecond domain fits below 2^53. The
  // sub-millisecond fragment is kept separately; a full timestamp never goes
  // through Number, and no large BigInt division is needed for ICU lookup.
  const milliseconds = day * MS_PER_DAY + Math.floor(time / 1000000);
  const fraction = time % 1000000;
  const former = offsetMilliseconds(zone.localOffsetMilliseconds(milliseconds, true));
  const latter = offsetMilliseconds(zone.localOffsetMilliseconds(milliseconds, false));
  const formerEpoch = milliseconds - former;
  if (former === latter) {
    checkEpochMilliseconds(formerEpoch, fraction);
    if (
      useOffset &&
      !offsetMatches(former, suppliedOffset, matchMinutes) &&
      offsetOption === "reject"
    )
      throw new RangeError("Offset does not match the time zone");
    return epochNanoseconds(formerEpoch, fraction);
  }
  const latterEpoch = milliseconds - latter;
  const formerPossible = offsetMilliseconds(zone.offsetMilliseconds(formerEpoch)) === former;
  const latterPossible = offsetMilliseconds(zone.offsetMilliseconds(latterEpoch)) === latter;
  // GetPossibleEpochNanoseconds checks every valid candidate before selection,
  // including the unselected occurrence of a fold near the Instant boundary.
  if (formerPossible) checkEpochMilliseconds(formerEpoch, fraction);
  if (latterPossible) checkEpochMilliseconds(latterEpoch, fraction);
  const first = formerEpoch < latterEpoch ? formerEpoch : latterEpoch;
  const last = formerEpoch > latterEpoch ? formerEpoch : latterEpoch;
  if (useOffset) {
    const formerMatches = formerPossible && offsetMatches(former, suppliedOffset, matchMinutes);
    const latterMatches = latterPossible && offsetMatches(latter, suppliedOffset, matchMinutes);
    if (formerMatches && latterMatches) return epochNanoseconds(first, fraction);
    if (formerMatches) return epochNanoseconds(formerEpoch, fraction);
    if (latterMatches) return epochNanoseconds(latterEpoch, fraction);
    if (offsetOption === "reject") throw new RangeError("Offset does not match the time zone");
  }
  if (formerPossible && !latterPossible) return epochNanoseconds(formerEpoch, fraction);
  if (latterPossible && !formerPossible) return epochNanoseconds(latterEpoch, fraction);
  if (disambiguation === "reject") throw new RangeError("Ambiguous local time");
  if (formerPossible && latterPossible)
    return epochNanoseconds(disambiguation === "later" ? last : first, fraction);
  return disambiguateGap(day, time, zone, disambiguation, latter - former);
}

export function startOfDay(day: number, zone: TimeZoneRules): bigint {
  const midnight = checkDateDay(day) * MS_PER_DAY;
  const former = offsetMilliseconds(zone.localOffsetMilliseconds(midnight, true));
  const latter = offsetMilliseconds(zone.localOffsetMilliseconds(midnight, false));
  const formerEpoch = midnight - former;
  if (former === latter) return epochNanoseconds(formerEpoch);
  const latterEpoch = midnight - latter;
  const formerPossible = offsetMilliseconds(zone.offsetMilliseconds(formerEpoch)) === former;
  const latterPossible = offsetMilliseconds(zone.offsetMilliseconds(latterEpoch)) === latter;
  if (formerPossible) checkEpochMilliseconds(formerEpoch, 0);
  if (latterPossible) checkEpochMilliseconds(latterEpoch, 0);
  if (formerPossible && latterPossible)
    return epochNanoseconds(formerEpoch < latterEpoch ? formerEpoch : latterEpoch);
  if (formerPossible) return epochNanoseconds(formerEpoch);
  if (latterPossible) return epochNanoseconds(latterEpoch);
  // Midnight is inside a gap. Compatible disambiguation would preserve its
  // position inside that gap; GetStartOfDay instead returns the transition.
  const lower = formerEpoch < latterEpoch ? formerEpoch : latterEpoch;
  const upper = formerEpoch > latterEpoch ? formerEpoch : latterEpoch;
  let next = zone.transition(lower - 1, true);
  while (next !== null && next <= upper) {
    if (!Number.isInteger(next) || next < lower)
      throw new Error("Time-zone provider returned an invalid transition");
    const before = next + offsetMilliseconds(zone.offsetMilliseconds(next - 1));
    const after = next + offsetMilliseconds(zone.offsetMilliseconds(next));
    if (before <= midnight && midnight < after) return epochNanoseconds(next);
    const following = zone.transition(next, true);
    if (following !== null && following <= next)
      throw new Error("Time-zone provider returned an invalid transition");
    next = following;
  }
  throw new Error("Time-zone provider did not resolve a missing midnight");
}

export function timeZoneTransitionMilliseconds(
  epoch: bigint,
  zone: TimeZoneRules,
  forward: boolean,
): number | null {
  checkInstant(epoch);
  const milliseconds = epochMilliseconds(epoch);
  // The provider's transition search is exclusive and has millisecond
  // precision. A previous search after a fractional millisecond must include
  // the transition at its floor; a next search already has the correct bound.
  const query = !forward && epoch % NS_PER_MILLISECOND !== 0n ? milliseconds + 1 : milliseconds;
  const next = zone.transition(query, forward);
  if (next === null) return null;
  if (!Number.isInteger(next)) throw new Error("Time-zone provider returned an invalid transition");
  const result = BigInt(next) * NS_PER_MILLISECOND;
  if (forward ? result <= epoch : result >= epoch)
    throw new Error("Time-zone provider returned an invalid transition");
  return result < -INSTANT_LIMIT || result > INSTANT_LIMIT ? null : next;
}

export function formatOffsetNanoseconds(offset: bigint): string {
  const magnitude = Number(offset < 0n ? -offset : offset);
  return (
    (offset < 0n ? "-" : "+") + formatPlainTime(magnitude, offset % NS_PER_MINUTE === 0n ? -2 : -1)
  );
}

export function formatRoundedOffset(offset: bigint): string {
  return formatOffsetTimeZone(
    Number(roundNanoseconds(offset, NS_PER_MINUTE, "halfExpand") / NS_PER_MINUTE),
  );
}
