// `timerify`, from node v24.20.0 `lib/internal/perf/timerify.js`.
//
// Wraps a function so every call is timed and reported as a `function` entry,
// and optionally recorded in a histogram in nanoseconds. A call that returns a
// promise-like is timed to its settlement; a construction is timed to the
// constructor's return.
//
// This is the one part of the module that is about the engine rather than
// about time. It forwards an arbitrary receiver and argument list, constructs
// through `Reflect.construct` when called with `new`, and gives the wrapper the
// wrapped function's arity and a derived name -- which a program compiled to a
// fixed layout cannot do for a function it does not know. Node's algorithm is
// kept as it is, and a compiled build refuses it by name rather than carrying
// a timerify that times something else.

import { ERR_INVALID_ARG_TYPE } from "../../internal/errors.ts";
import { validateFunction, validateObject } from "../../internal/validators.ts";
import { now } from "./clock.ts";
import { PerformanceNodeEntry, kSkipThrow } from "./entry.ts";
import { RecordableHistogram } from "./histogram.ts";
import { enqueue } from "./observe.ts";

/** What a timerified function may be: anything callable or constructible. */
type Timerifiable = (...args: unknown[]) => unknown;

export interface TimerifyOptions {
  histogram?: unknown;
}

/**
 * A `function` entry, which also carries the call's arguments at `entry[0]`,
 * `entry[1]`, ... -- node's older shape, still there beside `detail`.
 */
class PerformanceFunctionEntry extends PerformanceNodeEntry {
  [argument: number]: unknown;

  constructor(name: string, startTime: number, duration: number, args: unknown[]) {
    super(kSkipThrow, name, "function", startTime, duration, args);
    for (let index = 0; index < args.length; index++) this[index] = args[index];
  }
}

function processComplete(
  name: string,
  start: number,
  args: unknown[],
  histogram: RecordableHistogram | undefined,
): void {
  const duration = now() - start;
  if (histogram !== undefined) histogram.record(Math.ceil(duration * 1e6));
  enqueue(new PerformanceFunctionEntry(name, start, duration, args));
}

/** A value with a `finally`, which is what node takes as "this returned a promise". */
function hasFinally(value: unknown): value is { finally(onFinally: () => void): unknown } {
  return (
    value !== null &&
    (typeof value === "object" || typeof value === "function") &&
    "finally" in value &&
    typeof value.finally === "function"
  );
}

function recordableHistogramOrUndefined(histogram: unknown): RecordableHistogram | undefined {
  if (histogram === undefined || histogram instanceof RecordableHistogram) return histogram;
  throw new ERR_INVALID_ARG_TYPE("options.histogram", "RecordableHistogram", histogram);
}

export function timerify(fn: Timerifiable, options: TimerifyOptions = {}): Timerifiable {
  validateFunction(fn, "fn");
  validateObject(options, "options");
  const histogram = recordableHistogramOrUndefined(options.histogram);

  function timerified(this: unknown, ...args: unknown[]): unknown {
    const isConstructorCall = new.target !== undefined;
    const start = now();
    const result = isConstructorCall
      ? Reflect.construct(fn, args, fn)
      : Reflect.apply(fn, this, args);
    if (!isConstructorCall && hasFinally(result)) {
      return result.finally(() => processComplete(fn.name, start, args, histogram));
    }
    processComplete(fn.name, start, args, histogram);
    return result;
  }

  Object.defineProperties(timerified, {
    length: { configurable: false, enumerable: true, value: fn.length },
    name: { configurable: false, enumerable: true, value: `timerified ${fn.name}` },
  });
  return timerified;
}
