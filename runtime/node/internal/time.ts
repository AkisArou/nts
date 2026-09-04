// The timer table behind `console.time`, from node v24.20.0
// `lib/internal/util/debuglog.js`.
//
// It lives outside `node:console` because `console` is not the only caller:
// `node:test` reports durations the same way, and the format is specified once
// so that two subsystems cannot drift apart in how they print `1.500s`.

import { emitWarning } from "./process-warning.ts";

/** Monotonic nanoseconds. A duration measured with a wall clock is not one. */
declare function nts_hrtime_ns(): bigint;

const kSecond = 1000;
const kMinute = 60 * kSecond;
const kHour = 60 * kMinute;

function pad(value: number | string): string {
  return String(value).padStart(2, "0");
}

/**
 * A duration in the largest unit that keeps it readable.
 *
 *   `100.01ms`, `1.500s`, `1:00.300 (m:ss.mmm)`, `1:06:40.457 (h:mm:ss.mmm)`
 *
 * The parenthesised legend is there because `1:00.300` alone does not say
 * whether the first field is hours or minutes.
 */
export function formatTime(ms: number): string {
  let hours = 0;
  let minutes = 0;
  let seconds = 0;

  if (ms >= kSecond) {
    if (ms >= kMinute) {
      if (ms >= kHour) {
        hours = Math.floor(ms / kHour);
        ms = ms % kHour;
      }
      minutes = Math.floor(ms / kMinute);
      ms = ms % kMinute;
    }
    seconds = ms / kSecond;
  }

  if (hours !== 0 || minutes !== 0) {
    // `toFixed` first, so that 59.9995 seconds reads as `1:00.000` in both
    // halves rather than `0:59.1000`.
    const fixed = seconds.toFixed(3);
    const decimal = fixed.indexOf(".");
    const wholeSeconds = decimal === -1 ? fixed : fixed.slice(0, decimal);
    const millis = decimal === -1 ? "000" : fixed.slice(decimal + 1);
    const head = hours !== 0 ? `${hours}:${pad(minutes)}` : String(minutes);
    return `${head}:${pad(wholeSeconds)}.${millis} (${hours !== 0 ? "h:m" : ""}m:ss.mmm)`;
  }

  if (seconds !== 0) {
    return `${seconds.toFixed(3)}s`;
  }

  // Through `Number` to drop trailing zeros: `0.006ms`, not `0.006000ms`.
  return `${Number(ms.toFixed(3))}ms`;
}

/** What a started timer records. Monotonic, so a clock change cannot skew it. */
export type Timestamp = bigint;

export const now: () => Timestamp = nts_hrtime_ns;

/** A label started twice is a mistake worth reporting, and the second start is ignored. */
export function time(
  times: Map<string, Timestamp>,
  implementation: string,
  label: string,
): void {
  if (times.has(label)) {
    emitWarning(`Label '${label}' already exists for ${implementation}`, "Warning", "");
    return;
  }
  times.set(label, now());
}

/** How the elapsed time is reported: `(label, formatted, args?) => void`. */
export type LogImpl = (label: string, formatted: string, args?: unknown[]) => void;

function timeLogImpl(
  times: Map<string, Timestamp>,
  implementation: string,
  log: LogImpl,
  label: string,
  args: unknown[] | undefined,
): boolean {
  const started = times.get(label);
  if (started === undefined) {
    emitWarning(`No such label '${label}' for ${implementation}`, "Warning", "");
    return false;
  }
  log(label, formatTime(Number(now() - started) / 1e6), args);
  return true;
}

export function timeLog(
  times: Map<string, Timestamp>,
  implementation: string,
  log: LogImpl,
  label: string,
  args: unknown[],
): void {
  timeLogImpl(times, implementation, log, label, args);
}

export function timeEnd(
  times: Map<string, Timestamp>,
  implementation: string,
  log: LogImpl,
  label: string,
): void {
  if (timeLogImpl(times, implementation, log, label, undefined)) {
    times.delete(label);
  }
}
