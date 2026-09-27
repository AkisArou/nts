// `PerformanceEntry`, from node v24.20.0
// `lib/internal/perf/performance_entry.js`.
//
// Nothing outside this module may construct one: `new PerformanceEntry()`
// throws `ERR_ILLEGAL_CONSTRUCTOR`, while the module builds them freely. Node
// does that with a module-private symbol passed as the first constructor
// argument, and so does this -- the token is the one value a caller cannot
// name, which is the whole of the rule.

import { ERR_ILLEGAL_CONSTRUCTOR, ERR_INVALID_THIS } from "../../internal/errors.ts";
import { customInspectSymbol, inspect, type InspectOptions } from "../../util/src/inspect.ts";

/** The constructor token. Private to this module and the ones it hands it to. */
export const kSkipThrow: unique symbol = Symbol("kSkipThrow");

/**
 * What `util.inspect` prints for one of these past its depth limit: the class
 * name in brackets.
 *
 * Node gets that from its generic formatter, which brackets an object with own
 * keys once the depth runs out -- and node's instances have own keys, the
 * symbol-keyed internal fields they store their state in. These keep state in
 * private fields and have none, so the formatter would print `Name {}`
 * instead. The answer is stated here rather than recreated by giving the
 * instances keys nobody reads.
 */
export function atDepthLimit(value: object): string {
  return `[${value.constructor.name}]`;
}

/** The fields every entry serialises, in node's order. */
export interface PerformanceEntryJSON {
  name: string;
  entryType: string;
  startTime: number;
  duration: number;
}

/** An entry's fields with the `detail` that marks, measures and node's own entries carry. */
export interface PerformanceEntryDetailJSON extends PerformanceEntryJSON {
  detail: unknown;
}

/** One timed event on the performance timeline. */
export class PerformanceEntry {
  readonly #name: string;
  readonly #entryType: string;
  readonly #startTime: number;
  readonly #duration: number;

  constructor(
    skipThrow: unknown = undefined,
    name = "",
    entryType = "",
    startTime = 0,
    duration = 0,
  ) {
    if (skipThrow !== kSkipThrow) throw new ERR_ILLEGAL_CONSTRUCTOR();
    this.#name = name;
    this.#entryType = entryType;
    this.#startTime = startTime;
    this.#duration = duration;
  }

  /** Node's `validateThisInternalField`: a getter read off anything else throws. */
  static #check(value: unknown, className: string): void {
    if (value === null || typeof value !== "object" || !(#name in value)) {
      throw new ERR_INVALID_THIS(className);
    }
  }

  get name(): string {
    PerformanceEntry.#check(this, "PerformanceEntry");
    return this.#name;
  }

  get entryType(): string {
    PerformanceEntry.#check(this, "PerformanceEntry");
    return this.#entryType;
  }

  get startTime(): number {
    PerformanceEntry.#check(this, "PerformanceEntry");
    return this.#startTime;
  }

  get duration(): number {
    PerformanceEntry.#check(this, "PerformanceEntry");
    return this.#duration;
  }

  /**
   * `PerformanceMark { name: ..., ... }`: the class name, then
   * what `toJSON` would serialise, one level shallower.
   */
  [customInspectSymbol](depth: number, options: InspectOptions): unknown {
    if (depth < 0) return atDepthLimit(this);
    const nested: InspectOptions = {
      ...options,
      depth: options.depth == null ? null : options.depth - 1,
    };
    return `${this.constructor.name} ${inspect(this.toJSON(), nested)}`;
  }

  toJSON(): PerformanceEntryJSON {
    PerformanceEntry.#check(this, "PerformanceEntry");
    return {
      name: this.#name,
      entryType: this.#entryType,
      startTime: this.#startTime,
      duration: this.#duration,
    };
  }
}

/** An entry node's own subsystems report, carrying a `detail` of their choosing. */
export class PerformanceNodeEntry extends PerformanceEntry {
  readonly #detail: unknown;

  constructor(
    skipThrow: unknown,
    name: string,
    entryType: string,
    startTime: number,
    duration: number,
    detail: unknown,
  ) {
    super(skipThrow, name, entryType, startTime, duration);
    this.#detail = detail;
  }

  get detail(): unknown {
    if (!(#detail in this)) throw new ERR_INVALID_THIS("NodePerformanceEntry");
    return this.#detail;
  }

  override toJSON(): PerformanceEntryDetailJSON {
    return { ...super.toJSON(), detail: this.#detail };
  }
}

export function createPerformanceNodeEntry(
  name: string,
  entryType: string,
  startTime: number,
  duration: number,
  detail: unknown,
): PerformanceNodeEntry {
  return new PerformanceNodeEntry(kSkipThrow, name, entryType, startTime, duration, detail);
}
