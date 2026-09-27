// User Timing: `performance.mark` and `performance.measure`, from node
// v24.20.0 `lib/internal/perf/usertiming.js`.
//
// A mark is a named instant; a measure is the span between two of them. The
// names are resolved when the measure is taken, not when it is read, so a
// measure between `a` and `b` uses whichever `a` was marked last -- which is
// why the table of mark times is separate from the buffer of mark entries, and
// why clearing the entries (`clearMarks`) clears the table too.
//
// Six names are not marks at all: node's own lifecycle milestones. A measure
// may start or end at `nodeStart` or `bootstrapComplete`, and a mark may not
// take one of those names.
//
// # Arguments counted, not defaulted
//
// `performance.mark()` and `performance.mark(undefined)` differ: the first is
// `ERR_MISSING_ARGS`, the second a mark named `"undefined"`. Node tells them
// apart with `arguments.length`; this takes the arguments as a rest tuple,
// which asks the same question of a value the compiled program has.

import {
  ERR_ILLEGAL_CONSTRUCTOR,
  ERR_INVALID_ARG_VALUE,
  ERR_INVALID_THIS,
  ERR_MISSING_ARGS,
  ERR_PERFORMANCE_INVALID_TIMESTAMP,
  ERR_PERFORMANCE_MEASURE_INVALID_OPTIONS,
} from "../../internal/errors.ts";
import { validateNumber, validateObject, validateString } from "../../internal/validators.ts";
import { domException } from "../../internal/dom-exception.ts";
import { clone } from "../../internal/structured-clone.ts";
import { coerceToDOMString } from "../../../web-platform/src/core/webidl.ts";
import { now } from "./clock.ts";
import { PerformanceEntry, kSkipThrow, type PerformanceEntryDetailJSON } from "./entry.ts";
import { nodeTimingMilestone, isNodeTimingMilestone } from "./nodetiming.ts";
import { bufferUserTiming, enqueue } from "./observe.ts";

/** The latest time each mark name was set, which measures resolve names against. */
const markTimings = new Map<string, number>();

/** The options `performance.mark` reads. */
export interface PerformanceMarkOptions {
  detail?: unknown;
  startTime?: unknown;
}

/** The options `performance.measure` reads in place of a start mark. */
export interface PerformanceMeasureOptions {
  detail?: unknown;
  start?: unknown;
  end?: unknown;
  duration?: unknown;
}

/**
 * A mark name, a milestone name, or a time, as a time. A negative number is
 * rejected; a name nothing has marked is a `SyntaxError` `DOMException`, the
 * Web's error for a string that does not name what it should.
 */
function getMark(name: unknown): number | undefined {
  if (name === undefined) return undefined;
  if (typeof name === "number") {
    if (name < 0) throw new ERR_PERFORMANCE_INVALID_TIMESTAMP(name);
    return name;
  }
  const key = coerceToDOMString(name);
  if (isNodeTimingMilestone(key)) return nodeTimingMilestone(key);
  const time = markTimings.get(key);
  if (time === undefined) {
    throw domException(`The "${key}" performance mark has not been set`, "SyntaxError");
  }
  return time;
}

/** `value?.detail` for a value that may be any JavaScript value. */
function detailOf(value: unknown): unknown {
  if (value === null || typeof value !== "object") return undefined;
  return "detail" in value ? value.detail : undefined;
}

/** The detail a caller gave, cloned so later changes to theirs do not reach ours. */
function clonedDetail(detail: unknown): unknown {
  return detail != null ? clone(detail) : null;
}

export class PerformanceMark extends PerformanceEntry {
  readonly #detail: unknown;

  constructor(...args: [] | [name: unknown, options?: PerformanceMarkOptions | null]) {
    if (args.length === 0) throw new ERR_MISSING_ARGS("name");
    const name = coerceToDOMString(args[0]);
    if (isNodeTimingMilestone(name)) throw new ERR_INVALID_ARG_VALUE("name", name);
    const options = args[1];
    if (options != null) validateObject(options, "options");
    const startTime = options?.startTime ?? now();
    validateNumber(startTime, "startTime");
    if (startTime < 0) throw new ERR_PERFORMANCE_INVALID_TIMESTAMP(startTime);
    markTimings.set(name, startTime);
    const detail = clonedDetail(options?.detail);

    super(kSkipThrow, name, "mark", startTime, 0);
    this.#detail = detail;
  }

  get detail(): unknown {
    if (!(#detail in this)) throw new ERR_INVALID_THIS("PerformanceMark");
    return this.#detail;
  }

  override toJSON(): PerformanceEntryDetailJSON {
    return {
      name: this.name,
      entryType: this.entryType,
      startTime: this.startTime,
      duration: this.duration,
      detail: this.#detail,
    };
  }
}

export class PerformanceMeasure extends PerformanceEntry {
  readonly #detail: unknown;

  constructor(
    skipThrow: unknown = undefined,
    name = "",
    entryType = "",
    startTime = 0,
    duration = 0,
    detail: unknown = null,
  ) {
    if (skipThrow !== kSkipThrow) throw new ERR_ILLEGAL_CONSTRUCTOR();
    super(skipThrow, name, entryType, startTime, duration);
    this.#detail = detail;
  }

  get detail(): unknown {
    if (!(#detail in this)) throw new ERR_INVALID_THIS("PerformanceMeasure");
    return this.#detail;
  }

  override toJSON(): PerformanceEntryDetailJSON {
    return {
      name: this.name,
      entryType: this.entryType,
      startTime: this.startTime,
      duration: this.duration,
      detail: this.#detail,
    };
  }
}

/** `performance.mark`: make the mark, tell the observers, keep it. */
export function mark(name: unknown, options: PerformanceMarkOptions | null | undefined): PerformanceMark {
  const entry = new PerformanceMark(name, options);
  enqueue(entry);
  bufferUserTiming(entry);
  return entry;
}

/**
 * Where a measure starts and how long it is, from the three ways of saying so:
 * a start mark and an end mark; an options bag of `start`, `end` and
 * `duration`, any two of which decide the third; or nothing, which measures
 * from the time origin to now.
 */
function calculateStartDuration(
  startOrMeasureOptions: unknown,
  endMark: unknown,
): { start: number; duration: number } {
  const given = startOrMeasureOptions ?? 0;
  let startOption: unknown;
  let endOption: unknown;
  let durationOption: unknown;
  let optionsValid = false;
  if (typeof given === "object" && given !== null) {
    const options: PerformanceMeasureOptions = given;
    startOption = options.start;
    endOption = options.end;
    durationOption = options.duration;
    optionsValid = startOption !== undefined || endOption !== undefined;
  }
  if (optionsValid) {
    if (endMark !== undefined) {
      throw new ERR_PERFORMANCE_MEASURE_INVALID_OPTIONS("endMark must not be specified");
    }
    if (startOption === undefined && endOption === undefined) {
      throw new ERR_PERFORMANCE_MEASURE_INVALID_OPTIONS(
        "One of options.start or options.end is required",
      );
    }
    if (startOption !== undefined && endOption !== undefined && durationOption !== undefined) {
      throw new ERR_PERFORMANCE_MEASURE_INVALID_OPTIONS(
        "Must not have options.start, options.end, and options.duration specified",
      );
    }
  }

  // Each branch reads `getMark` of something known to be present, so each
  // yields a number; `NaN` arithmetic on `undefined` is not a path here.
  let end: number;
  if (endMark !== undefined) {
    end = getMark(endMark)!;
  } else if (optionsValid && endOption !== undefined) {
    end = getMark(endOption)!;
  } else if (optionsValid && startOption !== undefined && durationOption !== undefined) {
    end = getMark(startOption)! + getMark(durationOption)!;
  } else {
    end = now();
  }

  let start: number;
  if (typeof given === "string") {
    start = getMark(given)!;
  } else if (optionsValid && startOption !== undefined) {
    start = getMark(startOption)!;
  } else if (optionsValid && durationOption !== undefined && endOption !== undefined) {
    start = end - getMark(durationOption)!;
  } else {
    start = 0;
  }

  return { start, duration: end - start };
}

/** `performance.measure`: measure, tell the observers, keep it. */
export function measure(name: unknown, startOrMeasureOptions: unknown, endMark: unknown): PerformanceMeasure {
  validateString(name, "name");
  const { start, duration } = calculateStartDuration(startOrMeasureOptions, endMark);
  const detail = clonedDetail(detailOf(startOrMeasureOptions));
  const entry = new PerformanceMeasure(kSkipThrow, name, "measure", start, duration, detail);
  enqueue(entry);
  bufferUserTiming(entry);
  return entry;
}

/** Forget one mark name's time, or every one. A milestone cannot be forgotten. */
export function clearMarkTimings(name: string | undefined): void {
  if (name === undefined) {
    markTimings.clear();
    return;
  }
  if (isNodeTimingMilestone(name)) throw new ERR_INVALID_ARG_VALUE("name", name);
  markTimings.delete(name);
}
