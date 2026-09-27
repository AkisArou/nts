// `createHistogram` and `monitorEventLoopDelay`, from node v24.20.0
// `lib/internal/histogram.js`, `lib/internal/perf/event_loop_delay.js` and the
// C++ they sit on (`src/histogram.cc`, `src/histogram-inl.h`).
//
// Node splits a histogram across the two languages: the class a caller holds
// is JavaScript, the recording is C++, and every getter crosses between them.
// Here both halves are TypeScript, and `HistogramState` is the C++ half --
// the HDR structure plus the three counters node keeps beside it.
//
// # Counted beside the HDR structure, not read from it
//
// `count` and `exceeds` are node's own, not HdrHistogram's: a value outside
// the trackable range is refused by the structure and counted by node as
// `exceeds`, and `add` sums node's counters rather than re-deriving them. So
// `count` after an `add` that dropped values still includes them, exactly as
// node's does.

import {
  ERR_ILLEGAL_CONSTRUCTOR,
  ERR_INVALID_ARG_TYPE,
  ERR_INVALID_ARG_VALUE_RANGE,
  ERR_INVALID_THIS,
  ERR_OUT_OF_RANGE,
  ERR_OUT_OF_RANGE_BINDING,
} from "../../internal/errors.ts";
import {
  validateBoolean,
  validateInteger,
  validateNumber,
  validateObject,
} from "../../internal/validators.ts";
import { now as hrtime } from "../../internal/time.ts";
import { Timeout, insert } from "../../timers/src/timeout.ts";
import { clearInterval } from "../../timers/src/main.ts";
import { customInspectSymbol, inspect, type InspectOptions } from "../../util/src/inspect.ts";
import { atDepthLimit } from "./entry.ts";
import { HdrHistogram, kInt64Max } from "./hdr.ts";

/**
 * Per-iteration event loop latency, which only the loop can measure: libuv's
 * prepare and check phases bracket the wait for I/O, and a sample is the time
 * from one check phase to the next prepare phase -- how long JavaScript and
 * the other phases held the loop -- plus however far the wait overran the
 * timeout the loop gave it.
 *
 * `start` returns a sampler id. Samples are nanoseconds, queued natively and
 * taken here one at a time, 0 when none is waiting; recording each at the
 * moment the loop took it would cost a call back into the program on every
 * iteration of a loop that is supposed to be measuring its own idleness.
 */
/** @ntsAbi managed */
declare function nts_perf_hooks_iteration_sampler_start(): number;
/** @ntsAbi managed */
declare function nts_perf_hooks_iteration_sampler_stop(sampler: number): void;
/** @ntsAbi managed */
declare function nts_perf_hooks_iteration_sampler_take(sampler: number): number;

/** The recording half of a histogram: node's C++ `Histogram`. */
class HistogramState {
  readonly hdr: HdrHistogram;
  count = 0;
  exceeds = 0;
  /** The `hrtime` of the last `recordDelta`, or 0n before the first. */
  prev = 0n;

  /**
   * Samples taken somewhere else and not yet recorded -- a native sampler's
   * queue -- brought in before anything reads the histogram.
   */
  drain: () => void = () => {};

  constructor(lowest: number, highest: bigint, figures: number) {
    this.hdr = new HdrHistogram(lowest, highest, figures);
  }

  /** `Histogram::Record`: a refused value counts as `exceeds`, not `count`. */
  record(value: number): void {
    if (this.hdr.record(value)) this.count++;
    else this.exceeds++;
  }

  recordBigInt(value: bigint): void {
    if (this.hdr.recordBigInt(value)) this.count++;
    else this.exceeds++;
  }

  /**
   * `Histogram::RecordDelta`: the nanoseconds since the previous call, which
   * the first call only establishes.
   */
  recordDelta(): void {
    const time = hrtime();
    if (this.prev > 0n) this.record(Number(time - this.prev));
    this.prev = time;
  }

  reset(): void {
    this.hdr.reset();
    this.count = 0;
    this.exceeds = 0;
    this.prev = 0n;
  }

  /** `Histogram::Add`: the latest `prev` of the two survives. */
  add(other: HistogramState): void {
    this.count += other.count;
    this.exceeds += other.exceeds;
    if (other.prev > this.prev) this.prev = other.prev;
    this.hdr.add(other.hdr);
  }
}

/** `hdr_min` as a double: `INT64_MAX` rounded, 9223372036854776000, when empty. */
function minOf(hdr: HdrHistogram): number {
  const index = hdr.minIndex();
  return index === -1 ? Number(kInt64Max) : hdr.valueAt(index);
}

function minBigIntOf(hdr: HdrHistogram): bigint {
  const index = hdr.minIndex();
  return index === -1 ? kInt64Max : hdr.valueAtBigInt(index);
}

/**
 * The state behind any histogram, for the subclasses and `add`: a closure the
 * class installs, rather than a static method anyone holding a histogram
 * could reach through `h.constructor`.
 */
let stateOf: (histogram: Histogram) => HistogramState;

/** The constructor token, shared by the three histogram classes and nothing else. */
const kSkipThrow: unique symbol = Symbol("kSkipThrow");

/** The serialised form: `percentiles` as a plain object, keyed by percentile. */
export interface HistogramJSON {
  count: number;
  min: number;
  max: number;
  mean: number;
  exceeds: number;
  stddev: number;
  percentiles: Record<string, number>;
}

export class Histogram {
  readonly #state: HistogramState;
  /**
   * The one map `percentiles` and `percentilesBigInt` refill and return:
   * node's `kMap`, so two reads hand back the same object, holding whatever
   * the later read put in it.
   */
  readonly #map = new Map<number, number | bigint>();

  constructor(skipThrow: unknown = undefined, state?: HistogramState) {
    if (skipThrow !== kSkipThrow || state === undefined) throw new ERR_ILLEGAL_CONSTRUCTOR();
    this.#state = state;
  }

  static {
    stateOf = (histogram) => histogram.#state;
  }

  /** The state behind a histogram that is one, brought up to date. */
  static #check(value: unknown): HistogramState {
    if (value === null || typeof value !== "object" || !(#state in value)) {
      throw new ERR_INVALID_THIS("Histogram");
    }
    const state = value.#state;
    state.drain();
    return state;
  }

  get count(): number {
    return Histogram.#check(this).count;
  }

  get countBigInt(): bigint {
    return BigInt(Histogram.#check(this).count);
  }

  get min(): number {
    return minOf(Histogram.#check(this).hdr);
  }

  get minBigInt(): bigint {
    return minBigIntOf(Histogram.#check(this).hdr);
  }

  /** `hdr_max`: 0 when nothing non-zero was recorded. */
  get max(): number {
    const hdr = Histogram.#check(this).hdr;
    return hdr.maxNonZeroIndex === -1 ? 0 : hdr.highestAt(hdr.maxNonZeroIndex);
  }

  get maxBigInt(): bigint {
    const hdr = Histogram.#check(this).hdr;
    return hdr.maxNonZeroIndex === -1 ? 0n : hdr.highestAtBigInt(hdr.maxNonZeroIndex);
  }

  get mean(): number {
    return Histogram.#check(this).hdr.mean();
  }

  get exceeds(): number {
    return Histogram.#check(this).exceeds;
  }

  get exceedsBigInt(): bigint {
    return BigInt(Histogram.#check(this).exceeds);
  }

  get stddev(): number {
    return Histogram.#check(this).hdr.stddev();
  }

  /** The value at or below which `percentile` percent of recorded values lie. */
  percentile(percentile: number): number {
    const hdr = Histogram.#check(this).hdr;
    validatePercentile(percentile);
    return hdr.highestAt(hdr.percentileIndex(percentile));
  }

  percentileBigInt(percentile: number): bigint {
    const hdr = Histogram.#check(this).hdr;
    validatePercentile(percentile);
    return hdr.highestAtBigInt(hdr.percentileIndex(percentile));
  }

  get percentiles(): Map<number, number | bigint> {
    const hdr = Histogram.#check(this).hdr;
    const map = this.#map;
    map.clear();
    hdr.percentiles((percentile, index) => {
      map.set(percentile, index === -1 ? 0 : hdr.valueAt(index));
    });
    return map;
  }

  get percentilesBigInt(): Map<number, number | bigint> {
    const hdr = Histogram.#check(this).hdr;
    const map = this.#map;
    map.clear();
    hdr.percentiles((percentile, index) => {
      map.set(percentile, index === -1 ? 0n : hdr.valueAtBigInt(index));
    });
    return map;
  }

  reset(): void {
    Histogram.#check(this).reset();
  }

  [customInspectSymbol](depth: number, options: InspectOptions): unknown {
    if (depth < 0) return atDepthLimit(this);
    const nested: InspectOptions = {
      ...options,
      depth: options.depth == null ? null : options.depth - 1,
    };
    const summary = {
      min: this.min,
      max: this.max,
      mean: this.mean,
      exceeds: this.exceeds,
      stddev: this.stddev,
      count: this.count,
      percentiles: this.percentiles,
    };
    return `Histogram ${inspect(summary, nested)}`;
  }

  toJSON(): HistogramJSON {
    const hdr = Histogram.#check(this).hdr;
    const percentiles: Record<string, number> = {};
    hdr.percentiles((percentile, index) => {
      percentiles[String(percentile)] = index === -1 ? 0 : hdr.valueAt(index);
    });
    return {
      count: this.count,
      min: this.min,
      max: this.max,
      mean: this.mean,
      exceeds: this.exceeds,
      stddev: this.stddev,
      percentiles,
    };
  }
}

/** Node's percentile range check, the same for both getters. */
function validatePercentile(percentile: unknown): asserts percentile is number {
  validateNumber(percentile, "percentile");
  if (Number.isNaN(percentile) || percentile <= 0 || percentile > 100) {
    throw new ERR_OUT_OF_RANGE("percentile", "> 0 && <= 100", percentile);
  }
}

/** A histogram the program records into: what `createHistogram` returns. */
export class RecordableHistogram extends Histogram {
  constructor(skipThrow: unknown = undefined, state?: HistogramState) {
    if (skipThrow !== kSkipThrow) throw new ERR_ILLEGAL_CONSTRUCTOR();
    super(skipThrow, state);
  }

  static #check(value: unknown, name: string): HistogramState {
    if (!(value instanceof RecordableHistogram)) throw new ERR_INVALID_THIS(name);
    return stateOf(value);
  }

  /**
   * Record one value: a positive safe integer, or a bigint the native side
   * range-checks for itself -- which is why `record(0n)` is a bare
   * `value is out of range` where `record(0)` names the argument.
   */
  record(value: number | bigint): void {
    const state = RecordableHistogram.#check(this, "RecordableHistogram");
    if (typeof value === "bigint") {
      if (value < 1n || value > kInt64Max) throw new ERR_OUT_OF_RANGE_BINDING("value is out of range");
      state.recordBigInt(value);
      return;
    }
    validateInteger(value, "val", 1);
    state.record(value);
  }

  /** Record the nanoseconds since the last call; the first call only starts the clock. */
  recordDelta(): void {
    RecordableHistogram.#check(this, "RecordableHistogram").recordDelta();
  }

  /** Fold `other`'s recordings into this one. */
  add(other: RecordableHistogram): void {
    const state = RecordableHistogram.#check(this, "RecordableHistogram");
    if (!(other instanceof RecordableHistogram)) {
      throw new ERR_INVALID_ARG_TYPE("other", "RecordableHistogram", other);
    }
    state.add(stateOf(other));
  }
}

/** The options `createHistogram` reads. */
export interface RecordableHistogramOptions {
  lowest?: number | bigint;
  highest?: number | bigint;
  figures?: number;
}

/**
 * A histogram with a trackable range of `[lowest, highest]` at `figures`
 * significant decimal digits. `highest` must be at least twice `lowest`,
 * which is what gives the structure a bucket to put anything in.
 */
export function createHistogram(options: RecordableHistogramOptions = {}): RecordableHistogram {
  validateObject(options, "options");
  const { lowest = 1, highest = Number.MAX_SAFE_INTEGER, figures = 3 } = options;
  if (typeof lowest !== "bigint") {
    validateInteger(lowest, "options.lowest", 1, Number.MAX_SAFE_INTEGER);
  }
  if (typeof highest !== "bigint") {
    validateInteger(highest, "options.highest", 2 * Number(lowest), Number.MAX_SAFE_INTEGER);
  } else {
    // Node compares `highest < 2n * lowest` as written, and a number `lowest`
    // -- the default, 1 -- makes that expression throw before it compares. So
    // a bigint `highest` needs a bigint `lowest`, and without one this is the
    // engine's `TypeError`, as it is on node.
    if (typeof lowest !== "bigint") {
      throw new TypeError("Cannot mix BigInt and other types, use explicit conversions");
    }
    if (highest < 2n * lowest) throw new ERR_INVALID_ARG_VALUE_RANGE("options.highest", highest);
  }
  validateInteger(figures, "options.figures", 1, 5);
  const state = new HistogramState(Number(lowest), BigInt(highest), figures);
  return new RecordableHistogram(kSkipThrow, state);
}

/**
 * How an event loop delay histogram samples: an unreferenced timer that
 * records the time between its own firings, or a native hook on every loop
 * iteration. Neither keeps the process alive.
 */
interface Sampler {
  start(state: HistogramState): void;
  stop(state: HistogramState): void;
  /** Bring the histogram up to date before anything reads it. */
  drain(state: HistogramState): void;
}

/**
 * Node's `ELDHistogram`: every `resolution` milliseconds, record how long
 * it has actually been since the last firing. A loop that was blocked shows
 * up as a firing that came late. Node's histogram for this is
 * `{ lowest: 1000 }` -- nanoseconds, with microsecond resolution.
 */
class IntervalSampler implements Sampler {
  readonly #resolution: number;
  #timer: Timeout<[]> | undefined = undefined;

  constructor(resolution: number) {
    this.#resolution = resolution;
  }

  start(state: HistogramState): void {
    const timer = new Timeout<[]>(() => state.recordDelta(), this.#resolution, [], true, false);
    insert(timer, timer._idleTimeout);
    this.#timer = timer;
  }

  stop(_state: HistogramState): void {
    if (this.#timer !== undefined) clearInterval(this.#timer);
    this.#timer = undefined;
  }

  drain(_state: HistogramState): void {}
}

/** Node's `IterationHistogram`: one sample per loop iteration, taken natively. */
class IterationSampler implements Sampler {
  #sampler = -1;

  start(_state: HistogramState): void {
    this.#sampler = nts_perf_hooks_iteration_sampler_start();
  }

  stop(state: HistogramState): void {
    if (this.#sampler === -1) return;
    this.drain(state);
    nts_perf_hooks_iteration_sampler_stop(this.#sampler);
    this.#sampler = -1;
  }

  drain(state: HistogramState): void {
    if (this.#sampler === -1) return;
    for (;;) {
      const sample = nts_perf_hooks_iteration_sampler_take(this.#sampler);
      if (sample === 0) return;
      state.record(sample);
    }
  }
}

/** What `monitorEventLoopDelay` returns: a histogram that fills itself. */
export class ELDHistogram extends Histogram {
  #enabled = false;
  readonly #sampler: Sampler;

  constructor(skipThrow: unknown = undefined, state?: HistogramState, sampler?: Sampler) {
    if (skipThrow !== kSkipThrow || state === undefined || sampler === undefined) {
      throw new ERR_ILLEGAL_CONSTRUCTOR();
    }
    super(skipThrow, state);
    this.#sampler = sampler;
    state.drain = () => sampler.drain(state);
  }

  static #check(value: unknown): ELDHistogram {
    if (!(value instanceof ELDHistogram)) throw new ERR_INVALID_THIS("ELDHistogram");
    return value;
  }

  /** Start sampling. False, and nothing done, if it already was. */
  enable(): boolean {
    const self = ELDHistogram.#check(this);
    if (self.#enabled) return false;
    self.#enabled = true;
    self.#sampler.start(stateOf(self));
    return true;
  }

  /** Stop sampling. False, and nothing done, if it already was. */
  disable(): boolean {
    const self = ELDHistogram.#check(this);
    if (!self.#enabled) return false;
    self.#enabled = false;
    self.#sampler.stop(stateOf(self));
    return true;
  }

  /** `using h = monitorEventLoopDelay()` disables it at the end of the block. */
  [Symbol.dispose](): void {
    this.disable();
  }
}

/** The options `monitorEventLoopDelay` reads. */
export interface EventLoopMonitorOptions {
  resolution?: number;
  samplePerIteration?: boolean;
}

/**
 * A histogram of event loop delay, in nanoseconds. Disabled until `enable()`.
 *
 * `resolution` is the sampling interval in milliseconds; with
 * `samplePerIteration` there is no interval, and every loop iteration is one
 * sample.
 */
export function monitorEventLoopDelay(options: EventLoopMonitorOptions = {}): ELDHistogram {
  validateObject(options, "options");
  const { samplePerIteration = false, resolution = 10 } = options;
  validateBoolean(samplePerIteration, "options.samplePerIteration");
  validateInteger(resolution, "options.resolution", 1);
  // Node's two histograms differ in their lowest discernible value: a timer's
  // delay is at least a microsecond's worth of nanoseconds, while a loop
  // iteration can be faster than that and is recorded to the nanosecond.
  const state = samplePerIteration
    ? new HistogramState(1, kInt64Max, 3)
    : new HistogramState(1000, kInt64Max, 3);
  const sampler = samplePerIteration ? new IterationSampler() : new IntervalSampler(resolution);
  return new ELDHistogram(kSkipThrow, state, sampler);
}
