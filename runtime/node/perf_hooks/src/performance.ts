// The `performance` object, from node v24.20.0
// `lib/internal/perf/performance.js`, and `eventLoopUtilization`, from
// `lib/internal/perf/event_loop_utilization.js`.
//
// One instance, created here; `new Performance()` is illegal. It is an
// `EventTarget` because resource timing reports a full buffer by dispatching
// `resourcetimingbufferfull` on it.
//
// # Node's own additions are properties, not methods
//
// `performance.eventLoopUtilization`, `nodeTiming`, `markResourceTiming` and
// `timerify` are the module's functions and object, reachable from the
// instance: `performance.timerify === perf_hooks.timerify`. They are getters
// here, which keeps that identity; node holds them as writable data properties
// on the prototype, and `shape.mjs` gives them that form where it is
// observable.

import {
  ERR_ILLEGAL_CONSTRUCTOR,
  ERR_INVALID_ARG_TYPE_BINDING,
  ERR_INVALID_THIS,
  ERR_MISSING_ARGS,
} from "../../internal/errors.ts";
import {
  Event,
  EventTarget as WebEventTarget,
  eventTargetDispatchTrusted,
  eventTargetSetHandler,
  type EventHandlerSlot,
} from "../../../web-platform/src/core/events.ts";
import { coerceToDOMString, toUnsignedLong } from "../../../web-platform/src/core/webidl.ts";
import { customInspectSymbol, inspect, type InspectOptions } from "../../util/src/inspect.ts";
import { kMilestoneLoopStart, loopIdleTime, milestone, now, timeOrigin } from "./clock.ts";
import { atDepthLimit, type PerformanceEntry } from "./entry.ts";
import { nodeTiming, type PerformanceNodeTiming } from "./nodetiming.ts";
import {
  clearEntriesFromBuffer,
  filterBufferMapByNameAndType,
  setDispatchBufferFull,
  setResourceTimingBufferSize,
} from "./observe.ts";
import { markResourceTiming } from "./resource-timing.ts";
import { timerify } from "./timerify.ts";
import {
  clearMarkTimings,
  mark,
  measure,
  type PerformanceMark,
  type PerformanceMarkOptions,
  type PerformanceMeasure,
} from "./usertiming.ts";

/** How busy the event loop was: time spent waiting, time spent running. */
export interface EventLoopUtilization {
  idle: number;
  active: number;
  utilization: number;
}

/**
 * The event loop's utilization since it started, since `util1`, or between
 * two earlier readings.
 *
 * Active time is wall time since the loop started less the time it spent
 * waiting in the poll phase. Before the loop starts -- the first tick of the
 * main script -- every figure is 0.
 */
export function eventLoopUtilization(
  util1?: EventLoopUtilization,
  util2?: EventLoopUtilization,
): EventLoopUtilization {
  const loopStart = milestone(kMilestoneLoopStart);
  if (loopStart < 0) return { idle: 0, active: 0, utilization: 0 };

  if (util1 !== undefined && util2 !== undefined) {
    const idle = util1.idle - util2.idle;
    const active = util1.active - util2.active;
    return { idle, active, utilization: active / (idle + active) };
  }

  const idleTime = loopIdleTime();
  const active = now() - loopStart - idleTime;
  if (util1 === undefined) {
    return { idle: idleTime, active, utilization: active / (idleTime + active) };
  }

  const idleDelta = idleTime - util1.idle;
  const activeDelta = active - util1.active;
  return {
    idle: idleDelta,
    active: activeDelta,
    utilization: activeDelta / (idleDelta + activeDelta),
  };
}

/** What `performance.toJSON()` serialises. */
export interface PerformanceJSON {
  nodeTiming: PerformanceNodeTiming;
  timeOrigin: number;
  eventLoopUtilization: EventLoopUtilization;
}

/**
 * ECMAScript `ToNumber` as Web IDL's integer conversions begin it: a bigint or
 * a symbol throws, naming the argument, rather than converting.
 */
function toNumber(value: unknown, context: string): number {
  if (typeof value === "bigint") {
    throw new ERR_INVALID_ARG_TYPE_BINDING(`${context} is a BigInt and cannot be converted to a number.`);
  }
  if (typeof value === "symbol") {
    throw new ERR_INVALID_ARG_TYPE_BINDING(`${context} is a Symbol and cannot be converted to a number.`);
  }
  return Number(value);
}

/** The instance's constructor token; the class cannot be constructed from outside. */
const kPerformanceToken: unique symbol = Symbol("performance");

export class Performance extends WebEventTarget {
  readonly #bufferFull: EventHandlerSlot<Performance, Event> = { callback: null, listener: null };

  constructor(token: unknown = undefined) {
    if (token !== kPerformanceToken) throw new ERR_ILLEGAL_CONSTRUCTOR();
    super();
    // A full resource buffer is reported to this instance, and trusted, as a
    // browser's own event is.
    setDispatchBufferFull((type) => {
      this[eventTargetDispatchTrusted](new Event(type));
    });
  }

  static #check(value: unknown): void {
    if (value === null || typeof value !== "object" || !(#bufferFull in value)) {
      throw new ERR_INVALID_THIS("Performance");
    }
  }

  clearMarks(name: unknown = undefined): void {
    Performance.#check(this);
    const key = name === undefined ? undefined : coerceToDOMString(name);
    clearMarkTimings(key);
    clearEntriesFromBuffer("mark", key);
  }

  clearMeasures(name: unknown = undefined): void {
    Performance.#check(this);
    clearEntriesFromBuffer("measure", name === undefined ? undefined : coerceToDOMString(name));
  }

  clearResourceTimings(name: unknown = undefined): void {
    Performance.#check(this);
    clearEntriesFromBuffer("resource", name === undefined ? undefined : coerceToDOMString(name));
  }

  getEntries(): PerformanceEntry[] {
    Performance.#check(this);
    return filterBufferMapByNameAndType(undefined, undefined);
  }

  getEntriesByName(...args: [] | [name: unknown, type?: unknown]): PerformanceEntry[] {
    Performance.#check(this);
    if (args.length === 0) throw new ERR_MISSING_ARGS("name");
    const type = args[1];
    return filterBufferMapByNameAndType(
      coerceToDOMString(args[0]),
      type === undefined ? undefined : coerceToDOMString(type),
    );
  }

  getEntriesByType(...args: [] | [type: unknown]): PerformanceEntry[] {
    Performance.#check(this);
    if (args.length === 0) throw new ERR_MISSING_ARGS("type");
    return filterBufferMapByNameAndType(undefined, coerceToDOMString(args[0]));
  }

  mark(...args: [] | [name: unknown, options?: PerformanceMarkOptions | null]): PerformanceMark {
    Performance.#check(this);
    if (args.length === 0) throw new ERR_MISSING_ARGS("name");
    return mark(args[0], args[1]);
  }

  measure(
    ...args: [] | [name: unknown, startOrMeasureOptions?: unknown, endMark?: unknown]
  ): PerformanceMeasure {
    Performance.#check(this);
    if (args.length === 0) throw new ERR_MISSING_ARGS("name");
    return measure(args[0], args[1] === undefined ? {} : args[1], args[2]);
  }

  now(): number {
    Performance.#check(this);
    return now();
  }

  setResourceTimingBufferSize(...args: [] | [maxSize: unknown]): void {
    Performance.#check(this);
    if (args.length === 0) throw new ERR_MISSING_ARGS("maxSize");
    setResourceTimingBufferSize(toUnsignedLong(toNumber(args[0], "maxSize")));
  }

  get timeOrigin(): number {
    Performance.#check(this);
    return timeOrigin();
  }

  get onresourcetimingbufferfull(): ((this: Performance, event: Event) => void) | null {
    Performance.#check(this);
    return this.#bufferFull.callback;
  }

  set onresourcetimingbufferfull(callback: ((this: Performance, event: Event) => void) | null) {
    Performance.#check(this);
    this[eventTargetSetHandler](
      this,
      this.#bufferFull,
      "resourcetimingbufferfull",
      typeof callback === "function" ? callback : null,
      (_event): _event is Event => true,
    );
  }

  get eventLoopUtilization(): typeof eventLoopUtilization {
    return eventLoopUtilization;
  }

  get nodeTiming(): PerformanceNodeTiming {
    return nodeTiming;
  }

  get markResourceTiming(): typeof markResourceTiming {
    return markResourceTiming;
  }

  get timerify(): typeof timerify {
    return timerify;
  }

  toJSON(): PerformanceJSON {
    Performance.#check(this);
    return {
      nodeTiming: this.nodeTiming,
      timeOrigin: this.timeOrigin,
      eventLoopUtilization: this.eventLoopUtilization(),
    };
  }

  [customInspectSymbol](depth: number, options: InspectOptions): unknown {
    if (depth < 0) return atDepthLimit(this);
    const nested: InspectOptions = {
      ...options,
      depth: options.depth == null ? null : options.depth - 1,
    };
    const summary = { nodeTiming: this.nodeTiming, timeOrigin: this.timeOrigin };
    return `Performance ${inspect(summary, nested)}`;
  }
}

export const performance = new Performance(kPerformanceToken);
