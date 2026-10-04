import type { TimeZoneRules } from "./provider.ts";

function checkedOffset(value: number): number {
  if (!Number.isInteger(value) || Math.abs(value) >= 86400000)
    throw new Error("Time-zone provider returned an invalid offset");
  return value;
}

class OffsetPeriod {
  readonly from: number;
  readonly until: number;
  readonly offset: number;
  readonly previousOffset: number;
  readonly nextOffset: number;
  readonly localFrom: number;
  readonly localUntil: number;
  constructor(
    from: number,
    until: number,
    offset: number,
    previousOffset: number,
    nextOffset: number,
  ) {
    this.from = from;
    this.until = until;
    this.offset = offset;
    this.previousOffset = previousOffset;
    this.nextOffset = nextOffset;
    // Crop folds out of the image of this UTC period. What remains is an
    // unambiguous local interval; gaps lie outside it as well.
    this.localFrom = from + Math.max(offset, previousOffset);
    this.localUntil = until + Math.min(offset, nextOffset);
  }
  localOffset(local: number, former: boolean): number {
    if (local >= this.localFrom && local < this.localUntil) return this.offset;
    const beforeStart = this.from + this.previousOffset;
    const afterStart = this.from + this.offset;
    if (local >= Math.min(beforeStart, afterStart) && local < Math.max(beforeStart, afterStart))
      return former ? this.previousOffset : this.offset;
    const beforeEnd = this.until + this.offset;
    const afterEnd = this.until + this.nextOffset;
    if (local >= Math.min(beforeEnd, afterEnd) && local < Math.max(beforeEnd, afterEnd))
      return former ? this.offset : this.nextOffset;
    return NaN;
  }
}

// Cache public ICU rule data in shared TS. Two adjacent UTC periods retain both
// occurrences of a fold. Transition windows supply former/latter interpretations;
// no array of all transitions or timestamp-result cache is built.
export class CachedTimeZone<Z extends TimeZoneRules> {
  readonly id: string;
  readonly primaryId: string;
  readonly #rules: Z;
  readonly #periods: OffsetPeriod[] = [];
  #next = 0;
  constructor(rules: Z, id: string, primaryId: string) {
    this.id = id;
    this.primaryId = primaryId;
    this.#rules = rules;
  }
  offsetMilliseconds(milliseconds: number): number {
    const epoch = Math.floor(milliseconds);
    // The cache needs an exact +1 millisecond for an inclusive previous search.
    // The complete Temporal/Date lookup domain fits strictly inside this range.
    if (!Number.isSafeInteger(epoch) || epoch === Number.MAX_SAFE_INTEGER)
      return this.#rules.offsetMilliseconds(milliseconds);
    for (let index = 0; index < this.#periods.length; index++) {
      const period = this.#periods[index]!;
      if (epoch >= period.from && epoch < period.until) return period.offset;
    }
    const offset = checkedOffset(this.#rules.offsetMilliseconds(epoch));
    const previous = this.#rules.transition(epoch + 1, false);
    const next = this.#rules.transition(epoch, true);
    const from = previous === null ? -Infinity : previous;
    const until = next === null ? Infinity : next;
    if (
      from > epoch ||
      until <= epoch ||
      (previous !== null && !Number.isSafeInteger(previous)) ||
      (next !== null && !Number.isSafeInteger(next))
    )
      return offset;
    const previousOffset =
      previous === null ? offset : checkedOffset(this.#rules.offsetMilliseconds(from - 1));
    const nextOffset =
      next === null ? offset : checkedOffset(this.#rules.offsetMilliseconds(until));
    const period = new OffsetPeriod(from, until, offset, previousOffset, nextOffset);
    if (this.#periods.length < 2) this.#periods.push(period);
    else this.#periods[this.#next] = period;
    this.#next = (this.#next + 1) % 2;
    return offset;
  }
  localOffsetMilliseconds(milliseconds: number, former: boolean): number {
    const local = Math.floor(milliseconds);
    for (let index = 0; index < this.#periods.length; index++) {
      const value = this.#periods[index]!.localOffset(local, former);
      if (!Number.isNaN(value)) return value;
    }
    const offset = this.#rules.localOffsetMilliseconds(milliseconds, former);
    // A candidate inside a fold or gap still finds a neighboring UTC period.
    // Priming it also gives the other local interpretation on the next call.
    if (Number.isFinite(local) && Number.isFinite(offset)) this.offsetMilliseconds(local - offset);
    return offset;
  }
  transition(milliseconds: number, forward: boolean): number | null {
    return this.#rules.transition(milliseconds, forward);
  }
}
