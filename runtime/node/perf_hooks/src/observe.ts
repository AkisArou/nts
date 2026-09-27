// The performance timeline: the global entry buffers and the observers that
// watch them. From node v24.20.0 `lib/internal/perf/observe.js`.
//
// Two separate things live here and are easy to conflate. The *buffers* are
// what `performance.getEntries()` reads -- marks, measures and resource
// timings, kept until cleared. The *observers* are told about every entry of a
// type they asked for, whether or not it is buffered, and are told later: an
// entry queues its observers and one `setImmediate` delivers to all of them,
// so that a burst of marks reaches a callback as one list rather than one call
// each.
//
// Node's observer also counts subscriptions per native entry type (`gc`,
// `http`, `net`, ...) so that its C++ only produces those entries while
// someone listens. Nothing in this profile produces them, so there is nothing
// to switch on, and the counts are not kept.

import {
  ERR_ILLEGAL_CONSTRUCTOR,
  ERR_INVALID_ARG_TYPE,
  ERR_INVALID_ARG_VALUE,
  ERR_MISSING_ARGS,
  ERR_INVALID_THIS,
} from "../../internal/errors.ts";
import { validateFunction, validateObject } from "../../internal/validators.ts";
import { emitProcessWarning } from "../../internal/process-warning.ts";
import { setImmediate } from "../../timers/src/main.ts";
import { customInspectSymbol, inspect, type InspectOptions } from "../../util/src/inspect.ts";
import { coerceToDOMString } from "../../../web-platform/src/core/webidl.ts";
import { now } from "./clock.ts";
import { PerformanceEntry, atDepthLimit, createPerformanceNodeEntry } from "./entry.ts";
import { domException } from "../../internal/dom-exception.ts";

/**
 * What `PerformanceObserver.supportedEntryTypes` reports: one array, the same
 * each time. Node's is frozen, which is a fact about the object rather than
 * about its contents, and `shape.mjs` states it where it can be observed.
 */
const kSupportedEntryTypes: readonly string[] = [
  "dns",
  "function",
  "gc",
  "http",
  "http2",
  "mark",
  "measure",
  "net",
  "quic",
  "resource",
];

/** Past this many buffered marks (or measures), node warns once per type. */
const kPerformanceEntryBufferWarnSize = 1e6;

let markEntryBuffer: PerformanceEntry[] = [];
let measureEntryBuffer: PerformanceEntry[] = [];
let resourceTimingBuffer: PerformanceEntry[] = [];
let resourceTimingSecondaryBuffer: PerformanceEntry[] = [];
/** The resource buffer's capacity, which `setResourceTimingBufferSize` sets. */
let resourceTimingBufferSizeLimit = 250;
let resourceTimingBufferFullPending = false;
let dispatchBufferFull: (type: string) => void = () => {};
const warnedEntryTypes = new Set<string>();

/**
 * An observer's two internal operations, keyed by symbols this module keeps,
 * as node keys them: named methods would be on `PerformanceObserver.prototype`
 * for anyone to call and to see.
 */
const kMaybeBuffer: unique symbol = Symbol("kMaybeBuffer");
const kDispatch: unique symbol = Symbol("kDispatch");
const kObserves: unique symbol = Symbol("kObserves");

const observers = new Set<PerformanceObserver>();
const pending = new Set<PerformanceObserver>();
let isPending = false;

/** Deliver to every observer with something queued, on the next check phase. */
function queuePending(): void {
  if (isPending) return;
  isPending = true;
  setImmediate(() => {
    isPending = false;
    const delivering = Array.from(pending);
    pending.clear();
    for (const observer of delivering) observer[kDispatch]();
  });
}

/** Earliest first, the order every entry list is handed out in. */
function byStartTime(first: PerformanceEntry, second: PerformanceEntry): number {
  return first.startTime - second.startTime;
}

/** The entries an observer is handed, and nothing a caller can construct. */
export class PerformanceObserverEntryList {
  readonly #buffer: PerformanceEntry[];

  constructor(skipThrow: unknown = undefined, entries: PerformanceEntry[] = []) {
    if (skipThrow !== kListToken) throw new ERR_ILLEGAL_CONSTRUCTOR();
    this.#buffer = entries.sort(byStartTime);
  }

  static #check(value: unknown): void {
    if (value === null || typeof value !== "object" || !(#buffer in value)) {
      throw new ERR_INVALID_THIS("PerformanceObserverEntryList");
    }
  }

  getEntries(): PerformanceEntry[] {
    PerformanceObserverEntryList.#check(this);
    return this.#buffer.slice();
  }

  getEntriesByType(...args: [] | [type: unknown]): PerformanceEntry[] {
    PerformanceObserverEntryList.#check(this);
    if (args.length === 0) throw new ERR_MISSING_ARGS("type");
    const type = coerceToDOMString(args[0]);
    return this.#buffer.filter((entry) => entry.entryType === type);
  }

  getEntriesByName(...args: [] | [name: unknown, type?: unknown]): PerformanceEntry[] {
    PerformanceObserverEntryList.#check(this);
    if (args.length === 0) throw new ERR_MISSING_ARGS("name");
    const name = coerceToDOMString(args[0]);
    const type = args[1];
    if (type != null) {
      return this.#buffer.filter((entry) => entry.name === name && entry.entryType === type);
    }
    return this.#buffer.filter((entry) => entry.name === name);
  }

  [customInspectSymbol](depth: number, options: InspectOptions): unknown {
    if (depth < 0) return atDepthLimit(this);
    const nested: InspectOptions = {
      ...options,
      depth: options.depth == null ? null : options.depth - 1,
    };
    return `PerformanceObserverEntryList ${inspect(this.#buffer, nested)}`;
  }
}

/** The list constructor's token, distinct from the entries' so neither opens the other. */
const kListToken: unique symbol = Symbol("kSkipThrow");

/** How an observer was first asked to observe, which it may not change later. */
const kTypeSingle = 0;
const kTypeMultiple = 1;

export type PerformanceObserverCallback = (
  list: PerformanceObserverEntryList,
  observer: PerformanceObserver,
) => void;

/** The fields `observe` reads, each checked before it is trusted. */
export interface PerformanceObserverInit {
  entryTypes?: unknown;
  type?: unknown;
  buffered?: unknown;
}

export class PerformanceObserver {
  #buffer: PerformanceEntry[] = [];
  readonly #entryTypes = new Set<string>();
  #type: number | undefined = undefined;
  readonly #callback: PerformanceObserverCallback;

  constructor(callback: PerformanceObserverCallback) {
    validateFunction(callback, "callback");
    this.#callback = callback;
  }

  observe(options: PerformanceObserverInit = {}): void {
    validateObject(options, "options");
    const { entryTypes, type, buffered } = { ...options };
    if (entryTypes === undefined && type === undefined) {
      throw new ERR_MISSING_ARGS("options.entryTypes", "options.type");
    }
    if (entryTypes != null && type != null) {
      throw new ERR_INVALID_ARG_VALUE(
        "options.entryTypes",
        entryTypes,
        "options.entryTypes can not set with options.type together",
      );
    }

    switch (this.#type) {
      case undefined:
        if (entryTypes !== undefined) this.#type = kTypeMultiple;
        if (type !== undefined) this.#type = kTypeSingle;
        break;
      case kTypeSingle:
        if (entryTypes !== undefined) {
          throw domException(
            "PerformanceObserver can not change to multiple observations",
            "InvalidModificationError",
          );
        }
        break;
      case kTypeMultiple:
        if (type !== undefined) {
          throw domException(
            "PerformanceObserver can not change to single observation",
            "InvalidModificationError",
          );
        }
        break;
    }

    if (this.#type === kTypeMultiple) {
      if (!Array.isArray(entryTypes)) {
        throw new ERR_INVALID_ARG_TYPE("options.entryTypes", "string[]", entryTypes);
      }
      this.#entryTypes.clear();
      for (const entryType of entryTypes) {
        if (typeof entryType === "string" && kSupportedEntryTypes.includes(entryType)) {
          this.#entryTypes.add(entryType);
        }
      }
    } else {
      if (typeof type !== "string" || !kSupportedEntryTypes.includes(type)) return;
      this.#entryTypes.add(type);
      if (buffered) {
        this.#buffer.push(...filterBufferMapByNameAndType(undefined, type));
        pending.add(this);
        queuePending();
      }
    }

    if (this.#entryTypes.size !== 0) observers.add(this);
    else this.disconnect();
  }

  disconnect(): void {
    observers.delete(this);
    pending.delete(this);
    this.#buffer = [];
    this.#entryTypes.clear();
    this.#type = undefined;
  }

  takeRecords(): PerformanceEntry[] {
    const list = this.#buffer;
    this.#buffer = [];
    return list;
  }

  static get supportedEntryTypes(): readonly string[] {
    return kSupportedEntryTypes;
  }

  /** Whether this observer watches entries of `entryType`. */
  [kObserves](entryType: string): boolean {
    return this.#entryTypes.has(entryType);
  }

  /** Queue `entry` if it is a type this observer watches. */
  [kMaybeBuffer](entry: PerformanceEntry): void {
    if (!this.#entryTypes.has(entry.entryType)) return;
    this.#buffer.push(entry);
    pending.add(this);
    queuePending();
  }

  /** Hand everything queued to the callback, as one list. */
  [kDispatch](): void {
    const list = new PerformanceObserverEntryList(kListToken, this.takeRecords());
    this.#callback(list, this);
  }

  [customInspectSymbol](depth: number, options: InspectOptions): unknown {
    if (depth < 0) return this;
    const nested: InspectOptions = {
      ...options,
      depth: options.depth == null ? null : options.depth - 1,
    };
    const state = {
      connected: observers.has(this),
      pending: pending.has(this),
      entryTypes: Array.from(this.#entryTypes),
      buffer: this.#buffer,
    };
    return `PerformanceObserver ${inspect(state, nested)}`;
  }
}

/**
 * Queue a performance entry on every interested observer:
 * https://w3c.github.io/performance-timeline/#dfn-queue-a-performanceentry
 */
export function enqueue(entry: PerformanceEntry): void {
  if (!(entry instanceof PerformanceEntry)) {
    throw new ERR_INVALID_ARG_TYPE("entry", "PerformanceEntry", entry);
  }
  for (const observer of observers) observer[kMaybeBuffer](entry);
}

/**
 * Node's warning for an unbounded buffer, carrying which buffer and how full
 * it was: `warning.entryType` and `warning.count` on the `'warning'` event.
 */
class MaxPerformanceEntryBufferExceededWarning extends Error {
  // Declared, not defined: a defined field would become an own key before
  // `name` does, and node's warning lists `name`, `entryType`, `count`.
  declare readonly entryType: string;
  declare readonly count: number;

  constructor(message: string, entryType: string, count: number) {
    super(message);
    this.name = "MaxPerformanceEntryBufferExceededWarning";
    this.entryType = entryType;
    this.count = count;
  }
}

/** Add a mark or a measure to the global buffer. */
export function bufferUserTiming(entry: PerformanceEntry): void {
  const entryType = entry.entryType;
  let buffer: PerformanceEntry[];
  let clear: string;
  if (entryType === "mark") {
    buffer = markEntryBuffer;
    clear = "performance.clearMarks";
  } else if (entryType === "measure") {
    buffer = measureEntryBuffer;
    clear = "performance.clearMeasures";
  } else {
    return;
  }

  buffer.push(entry);
  const count = buffer.length;
  if (count > kPerformanceEntryBufferWarnSize && !warnedEntryTypes.has(entryType)) {
    warnedEntryTypes.add(entryType);
    emitProcessWarning(
      new MaxPerformanceEntryBufferExceededWarning(
        `Possible perf_hooks memory leak detected. ${count} ${entryType} entries added to ` +
          `the global performance entry buffer. Use ${clear} to clear the buffer.`,
        entryType,
        count,
      ),
      "",
    );
  }
}

/**
 * Add a resource timing entry to the global buffer, or hold it back and tell
 * the `performance` object its buffer is full:
 * https://w3c.github.io/resource-timing/#dfn-add-a-performanceresourcetiming-entry
 *
 * Held-back entries go into a secondary buffer. Once per burst, on the next
 * check phase, `resourcetimingbufferfull` is dispatched so a listener can
 * clear the buffer or raise its size, and as many held entries as then fit are
 * moved across. It repeats while a listener keeps making room, and gives up on
 * the rest the first time one does not.
 */
export function bufferResourceTiming(entry: PerformanceEntry): void {
  if (
    resourceTimingBuffer.length < resourceTimingBufferSizeLimit &&
    !resourceTimingBufferFullPending
  ) {
    resourceTimingBuffer.push(entry);
    return;
  }

  if (!resourceTimingBufferFullPending) {
    resourceTimingBufferFullPending = true;
    setImmediate(() => {
      while (resourceTimingSecondaryBuffer.length > 0) {
        const excessNumberBefore = resourceTimingSecondaryBuffer.length;
        dispatchBufferFull("resourcetimingbufferfull");

        const numbersToPreserve = Math.max(
          Math.min(
            resourceTimingBufferSizeLimit - resourceTimingBuffer.length,
            resourceTimingSecondaryBuffer.length,
          ),
          0,
        );
        const excessNumberAfter = resourceTimingSecondaryBuffer.length - numbersToPreserve;
        for (let index = 0; index < numbersToPreserve; index++) {
          resourceTimingBuffer.push(resourceTimingSecondaryBuffer[index]!);
        }

        if (excessNumberBefore <= excessNumberAfter) {
          resourceTimingSecondaryBuffer = [];
        }
      }
      resourceTimingBufferFullPending = false;
    });
  }

  resourceTimingSecondaryBuffer.push(entry);
}

/**
 * https://w3c.github.io/resource-timing/#dom-performance-setresourcetimingbuffersize
 *
 * Shrinking below the current size removes nothing; it only stops the buffer
 * growing until it is cleared.
 */
export function setResourceTimingBufferSize(maxSize: number): void {
  resourceTimingBufferSizeLimit = maxSize;
}

/** Who to tell that the resource buffer filled: the `performance` object. */
export function setDispatchBufferFull(dispatch: (type: string) => void): void {
  dispatchBufferFull = dispatch;
}

/** `clearMarks`, `clearMeasures` and `clearResourceTimings`, by name or all. */
export function clearEntriesFromBuffer(type: string, name: string | undefined): void {
  const keep = (entry: PerformanceEntry): boolean => entry.name !== name;
  if (type === "mark") {
    markEntryBuffer = name === undefined ? [] : markEntryBuffer.filter(keep);
  } else if (type === "measure") {
    measureEntryBuffer = name === undefined ? [] : measureEntryBuffer.filter(keep);
  } else if (type === "resource") {
    resourceTimingBuffer = name === undefined ? [] : resourceTimingBuffer.filter(keep);
  }
}

/**
 * The buffered entries with this name and of this type, either filter left
 * out when `undefined`, earliest first. An unknown type has no entries.
 */
export function filterBufferMapByNameAndType(
  name: string | undefined,
  type: string | undefined,
): PerformanceEntry[] {
  let bufferList: PerformanceEntry[];
  if (type === "mark") {
    bufferList = markEntryBuffer;
  } else if (type === "measure") {
    bufferList = measureEntryBuffer;
  } else if (type === "resource") {
    bufferList = resourceTimingBuffer;
  } else if (type !== undefined) {
    return [];
  } else {
    bufferList = [...markEntryBuffer, ...measureEntryBuffer, ...resourceTimingBuffer];
  }
  if (name !== undefined) {
    bufferList = bufferList.filter((entry) => entry.name === name);
  } else if (type !== undefined) {
    bufferList = bufferList.slice();
  }
  return bufferList.sort(byStartTime);
}

/**
 * Whether any observer watches `type`: node's `hasObserver`, which the
 * subsystems that time themselves -- `dns`, `net`, `http` -- ask before they
 * start a clock, so an unobserved call costs nothing.
 */
export function hasObserver(type: string): boolean {
  for (const observer of observers) {
    if (observer[kObserves](type)) return true;
  }
  return false;
}

/** A timing started by `startPerf` and not yet reported. */
export interface PerfContext {
  readonly type: string;
  readonly name: string;
  readonly startTime: number;
  readonly detail: Record<string, unknown>;
}

/** Start timing one operation: node's `startPerf`. */
export function startPerf(type: string, name: string, detail: Record<string, unknown>): PerfContext {
  return { type, name, detail, startTime: now() };
}

/**
 * Report a timed operation as an entry of its type: node's `stopPerf`. The
 * detail is the start's with the result's laid over it.
 */
export function stopPerf(context: PerfContext | undefined, detail: Record<string, unknown>): void {
  if (context === undefined) return;
  enqueue(
    createPerformanceNodeEntry(
      context.name,
      context.type,
      context.startTime,
      now() - context.startTime,
      { ...context.detail, ...detail },
    ),
  );
}
