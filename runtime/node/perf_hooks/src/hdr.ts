// The recording structure behind every `node:perf_hooks` histogram: an HDR
// histogram, as node v24.20.0 gets it from HdrHistogram_c in C++
// (`src/histogram-inl.h` over `deps/histogram`).
//
// Node's tests assert its exact answers -- `min` of an empty histogram is
// `9223372036854775807n`, `percentiles` of one recorded `1` is
// `Map { 0 => 1, 100 => 1 }` -- and those come from the bucket arithmetic, not
// from the values recorded. So this is that arithmetic, step for step, rather
// than a histogram that happens to agree on easy inputs.
//
// # Counts by index, never values
//
// A value is kept as the index of the bucket it lands in. Everything a caller
// can read back -- `min`, `max`, a percentile, the mean -- is a function of
// indices: HdrHistogram_c tracks the raw extremes, but reports them only
// through `lowest_equivalent_value` and `highest_equivalent_value`, which read
// nothing but the value's bucket. Keeping indices means a value never has to be
// held as a 64-bit integer, and every recorded number up to 2^53 takes the
// double-precision path.
//
// The one place that is not enough is an answer *as a bigint* past 2^53, where
// `highest_equivalent_value` is `2^k * m - 1` and a double cannot hold the
// `- 1`. Those are computed from the index in bigint arithmetic, so
// `maxBigInt` is exact where `max` is the nearest double -- which is also what
// node's `max` is, being `static_cast<double>` of the same int64.

/** `INT64_MAX`, the "nothing recorded" minimum node reports. */
export const kInt64Max = 9223372036854775807n;

const kTwo32 = 4294967296;

/** Bits needed to write `value`, a non-negative integer below 2^64. */
function bitLength(value: number): number {
  if (value < kTwo32) return 32 - Math.clz32(value);
  return 64 - Math.clz32(Math.floor(value / kTwo32));
}

/** `value * 2^shift`, exact while the result is below 2^1024. */
function shiftLeft(value: number, shift: number): number {
  return value * 2 ** shift;
}

/**
 * One HDR histogram's layout and counts.
 *
 * The fields keep HdrHistogram_c's names, because the functions below are its
 * functions and a reader checking one against the other should not have to
 * translate.
 */
export class HdrHistogram {
  readonly lowestDiscernibleValue: number;
  readonly highestTrackableValue: bigint;
  /**
   * `highestTrackableValue` for comparing a number against: exact up to 2^53,
   * and past that above every number `record` is given.
   */
  readonly #highestNumber: number;
  readonly significantFigures: number;
  readonly unitMagnitude: number;
  readonly subBucketHalfCountMagnitude: number;
  readonly subBucketCount: number;
  readonly subBucketHalfCount: number;
  /** Bit length of `sub_bucket_mask`, which is all a bucket lookup reads of it. */
  readonly subBucketMaskBits: number;
  readonly bucketCount: number;
  readonly countsLen: number;
  readonly counts: Float64Array;
  /** `total_count`: what the histogram holds, which `mean` divides by. */
  totalCount = 0;
  /**
   * The index of the smallest non-zero value recorded, or -1. `min_value` in
   * HdrHistogram_c, kept as the one thing about it anything reads.
   */
  minNonZeroIndex = -1;
  /**
   * The index of the largest non-zero value recorded, or -1: `max_value`,
   * which `hdr_max` reports as 0 while it is still 0.
   */
  maxNonZeroIndex = -1;
  /** The highest index holding any count, which bounds every scan. */
  highestIndex = -1;

  /**
   * `hdr_init`. The caller has validated the three arguments. `highest` is a
   * bigint because the bucket count turns on whether it reaches a power of
   * two, and `2^60 - 1` as a double is `2^60`.
   */
  constructor(lowest: number, highest: bigint, figures: number) {
    this.lowestDiscernibleValue = lowest;
    this.highestTrackableValue = highest;
    this.#highestNumber = Number(highest);
    this.significantFigures = figures;

    const largestValueWithSingleUnitResolution = 2 * 10 ** figures;
    const subBucketCountMagnitude = Math.ceil(Math.log2(largestValueWithSingleUnitResolution));
    this.subBucketHalfCountMagnitude = Math.max(subBucketCountMagnitude, 1) - 1;
    this.unitMagnitude = bitLength(lowest) - 1;
    this.subBucketCount = 2 ** (this.subBucketHalfCountMagnitude + 1);
    this.subBucketHalfCount = this.subBucketCount / 2;
    this.subBucketMaskBits = this.subBucketHalfCountMagnitude + 1 + this.unitMagnitude;

    // `buckets_needed_to_cover_value`: double the reach until it passes the
    // highest trackable value, with one more bucket once doubling again would
    // overflow an int64.
    let smallestUntrackableValue = BigInt(this.subBucketCount) << BigInt(this.unitMagnitude);
    let bucketsNeeded = 1;
    while (smallestUntrackableValue <= highest) {
      if (smallestUntrackableValue > kInt64Max / 2n) {
        bucketsNeeded++;
        break;
      }
      smallestUntrackableValue <<= 1n;
      bucketsNeeded++;
    }
    this.bucketCount = bucketsNeeded;
    this.countsLen = (this.bucketCount + 1) * this.subBucketHalfCount;
    this.counts = new Float64Array(this.countsLen);
  }

  /** `get_bucket_index` for a value below 2^53. */
  bucketIndexOf(value: number): number {
    const pow2ceiling = Math.max(bitLength(value), this.subBucketMaskBits);
    return pow2ceiling - this.unitMagnitude - (this.subBucketHalfCountMagnitude + 1);
  }

  /** `counts_index_for`, or -1 past the end of `counts`. */
  indexOf(value: number): number {
    const bucketIndex = this.bucketIndexOf(value);
    const subBucketIndex = Math.floor(value / 2 ** (bucketIndex + this.unitMagnitude));
    const index =
      (bucketIndex + 1) * this.subBucketHalfCount + (subBucketIndex - this.subBucketHalfCount);
    return index < this.countsLen ? index : -1;
  }

  /**
   * `counts_index_for` for a bigint, which is how a value past 2^53 arrives:
   * `record(2n ** 60n)`. The same arithmetic, in the type that can hold it.
   */
  indexOfBigInt(value: bigint): number {
    if (value <= BigInt(Number.MAX_SAFE_INTEGER)) return this.indexOf(Number(value));
    const pow2ceiling = Math.max(value.toString(2).length, this.subBucketMaskBits);
    const bucketIndex = pow2ceiling - this.unitMagnitude - (this.subBucketHalfCountMagnitude + 1);
    const subBucketIndex = Number(value >> BigInt(bucketIndex + this.unitMagnitude));
    const index =
      (bucketIndex + 1) * this.subBucketHalfCount + (subBucketIndex - this.subBucketHalfCount);
    return index < this.countsLen ? index : -1;
  }

  /** The two coordinates of an index: `hdr_value_at_index`'s first half. */
  #coordinates(index: number): [bucketIndex: number, subBucketIndex: number] {
    let bucketIndex = Math.floor(index / this.subBucketHalfCount) - 1;
    let subBucketIndex = (index % this.subBucketHalfCount) + this.subBucketHalfCount;
    if (bucketIndex < 0) {
      subBucketIndex -= this.subBucketHalfCount;
      bucketIndex = 0;
    }
    return [bucketIndex, subBucketIndex];
  }

  /**
   * `size_of_equivalent_value_range` as a power of two: the bucket's shift,
   * one more where the sub-bucket index has spilled past the bucket.
   */
  #rangeShift(bucketIndex: number, subBucketIndex: number): number {
    const adjusted = subBucketIndex >= this.subBucketCount ? bucketIndex + 1 : bucketIndex;
    return this.unitMagnitude + adjusted;
  }

  /** `hdr_value_at_index`, which is also the index's lowest equivalent value. */
  valueAt(index: number): number {
    const [bucketIndex, subBucketIndex] = this.#coordinates(index);
    return shiftLeft(subBucketIndex, bucketIndex + this.unitMagnitude);
  }

  /** `highest_equivalent_value` of the index's values. */
  highestAt(index: number): number {
    const [bucketIndex, subBucketIndex] = this.#coordinates(index);
    const lowest = shiftLeft(subBucketIndex, bucketIndex + this.unitMagnitude);
    return lowest + 2 ** this.#rangeShift(bucketIndex, subBucketIndex) - 1;
  }

  /** `hdr_median_equivalent_value` of the index's values. */
  medianAt(index: number): number {
    const [bucketIndex, subBucketIndex] = this.#coordinates(index);
    const lowest = shiftLeft(subBucketIndex, bucketIndex + this.unitMagnitude);
    return lowest + Math.floor(2 ** this.#rangeShift(bucketIndex, subBucketIndex) / 2);
  }

  /** `valueAt`, exactly, as a bigint. */
  valueAtBigInt(index: number): bigint {
    const [bucketIndex, subBucketIndex] = this.#coordinates(index);
    return BigInt(subBucketIndex) << BigInt(bucketIndex + this.unitMagnitude);
  }

  /** `highestAt`, exactly, as a bigint. */
  highestAtBigInt(index: number): bigint {
    const [bucketIndex, subBucketIndex] = this.#coordinates(index);
    const lowest = BigInt(subBucketIndex) << BigInt(bucketIndex + this.unitMagnitude);
    return lowest + (1n << BigInt(this.#rangeShift(bucketIndex, subBucketIndex))) - 1n;
  }

  /**
   * `hdr_record_values` for a value already placed: `index` is `indexOf` of a
   * value, and `nonZero` whether that value was not 0 -- the one fact about it
   * `update_min_max` needs beyond its bucket.
   */
  recordAt(index: number, nonZero: boolean, count: number): boolean {
    if (index < 0) return false;
    this.counts[index] = this.counts[index]! + count;
    this.totalCount += count;
    if (nonZero) {
      if (this.minNonZeroIndex === -1 || index < this.minNonZeroIndex) this.minNonZeroIndex = index;
      if (index > this.maxNonZeroIndex) this.maxNonZeroIndex = index;
    }
    if (index > this.highestIndex) this.highestIndex = index;
    return true;
  }

  /**
   * `hdr_record_value` for a number. A value above the highest trackable one
   * is refused even where the last bucket could hold it: `{ highest: 11 }`
   * takes 11 and refuses 12, though both share a bucket.
   */
  record(value: number): boolean {
    return this.recordCount(value, 1);
  }

  /** `hdr_record_values`: `count` recordings of one number. */
  recordCount(value: number, count: number): boolean {
    if (value < 0 || value > this.#highestNumber) return false;
    return this.recordAt(this.indexOf(value), value !== 0, count);
  }

  /** `hdr_record_values` for a bigint. */
  recordBigInt(value: bigint, count = 1): boolean {
    if (value < 0n || value > this.highestTrackableValue) return false;
    return this.recordAt(this.indexOfBigInt(value), value !== 0n, count);
  }

  /** `hdr_reset`. */
  reset(): void {
    this.counts.fill(0);
    this.totalCount = 0;
    this.minNonZeroIndex = -1;
    this.maxNonZeroIndex = -1;
    this.highestIndex = -1;
  }

  /**
   * `hdr_add`: every recorded bucket of `other`, re-recorded here at its
   * lowest equivalent value. Returns how many were dropped for falling
   * outside this histogram's range.
   */
  add(other: HdrHistogram): number {
    let dropped = 0;
    for (let index = 0; index < other.countsLen; index++) {
      const count = other.counts[index]!;
      if (count === 0) continue;
      const value = other.valueAt(index);
      const recorded = value <= Number.MAX_SAFE_INTEGER
        ? this.recordCount(value, count)
        : this.recordBigInt(other.valueAtBigInt(index), count);
      if (!recorded) dropped += count;
    }
    return dropped;
  }

  /**
   * The index `hdr_min` reads, or -1 for "nothing non-zero recorded", which
   * node reports as `INT64_MAX`. A count at index 0 answers 0 whatever else
   * was recorded, because every value in that bucket is equivalent to 0.
   */
  minIndex(): number {
    if (this.counts[0]! > 0) return 0;
    return this.minNonZeroIndex;
  }

  /** `hdr_mean`: NaN for an empty histogram, as node reports it. */
  mean(): number {
    let total = 0;
    for (let index = 0; index <= this.highestIndex; index++) {
      const count = this.counts[index]!;
      if (count !== 0) total += count * this.medianAt(index);
    }
    return total / this.totalCount;
  }

  /** `hdr_stddev`. */
  stddev(): number {
    const mean = this.mean();
    let geometricDevTotal = 0;
    for (let index = 0; index <= this.highestIndex; index++) {
      const count = this.counts[index]!;
      if (count === 0) continue;
      const dev = this.medianAt(index) - mean;
      geometricDevTotal += dev * dev * count;
    }
    return Math.sqrt(geometricDevTotal / this.totalCount);
  }

  /**
   * The index `hdr_value_at_percentile` reports from. With nothing recorded
   * that is index 0: it falls back to the value 0, and reports the highest
   * value equivalent to 0 -- which is not 0 once `lowest` is above 1.
   */
  percentileIndex(percentile: number): number {
    const requested = percentile < 100 ? percentile : 100;
    // `(int64_t)(x + 0.5)`: truncation, which for a non-negative `x` is floor.
    let countAtPercentile = Math.floor((requested / 100) * this.totalCount + 0.5);
    if (countAtPercentile < 1) countAtPercentile = 1;
    let countToIndex = 0;
    for (let index = 0; index < this.countsLen; index++) {
      countToIndex += this.counts[index]!;
      if (countToIndex >= countAtPercentile) return index;
    }
    return 0;
  }

  /**
   * `hdr_iter_percentile_init(&iter, h, 1)` driven to the end, which is what
   * node's `percentiles` getter does: each report is a percentile and the
   * value at the index the iterator stood on.
   *
   * `ticks_per_half_distance` is always 1 in node, so it is not a parameter.
   */
  percentiles(visit: (percentile: number, index: number) => void): void {
    const total = this.totalCount;
    let countsIndex = -1;
    let count = 0;
    let cumulative = 0;
    let percentileToIterateTo = 0;

    // `basic_iter_next`: stop once everything has been counted, or at the end
    // of the array.
    const basicNext = (): boolean => {
      if (!(cumulative < total)) return false;
      countsIndex++;
      if (countsIndex >= this.countsLen) return false;
      count = this.counts[countsIndex]!;
      cumulative += count;
      return true;
    };

    for (;;) {
      if (!(cumulative < total)) {
        // The last report is 100, whether or not the loop reached it, and it
        // stands on wherever the iterator stopped.
        visit(100, countsIndex);
        return;
      }
      if (countsIndex === -1 && !basicNext()) return;
      let reported = false;
      do {
        const currentPercentile = (100 * cumulative) / total;
        if (count !== 0 && percentileToIterateTo <= currentPercentile) {
          visit(percentileToIterateTo, countsIndex);
          const temp = Math.trunc(Math.log(100 / (100 - percentileToIterateTo)) / Math.log(2)) + 1;
          const halfDistance = Math.trunc(2 ** temp);
          percentileToIterateTo += 100 / halfDistance;
          reported = true;
          break;
        }
      } while (basicNext());
      // `percentile_iter_next` returns true after the loop runs out as well,
      // reporting nothing new; the next call then takes the last-value arm.
      if (!reported && cumulative < total) return;
    }
  }
}
