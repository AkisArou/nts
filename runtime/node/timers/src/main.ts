// `node:timers`, from node v24.20.0 `lib/timers.js`.
//
// The three scheduling functions and the three that undo them. The machinery
// they drive is in `timeout.ts` and `immediate.ts`; what is here is the public
// surface, the argument checking, and the one line that connects the module to
// the loop.
//
// These are globals as well as module exports, and the global is the one
// almost every program uses. `shape.mjs` installs them.

import * as promises from "./promises.ts";
import * as host from "./host.ts";
import { validateFunction } from "../../internal/validators.ts";
import {
  Immediate,
  clearImmediate,
  processImmediate,
} from "./immediate.ts";
import {
  Timeout,
  clearTimeout,
  insert,
  processTimers,
} from "./timeout.ts";

/**
 * Hand the two drains to the loop.
 *
 * Once, at module evaluation, mirroring node's `setupTimers` call during
 * bootstrap. Everything after this point is the loop calling back in.
 */
host.install(processTimers, processImmediate);

/** Run `callback` once, after at least `after` milliseconds. */
export function setTimeout<A extends unknown[]>(
  callback: (...args: A) => void,
  after?: number,
  ...args: A
): Timeout {
  validateFunction(callback, "callback");
  const timeout = new Timeout(
    callback as never,
    after,
    args.length ? args : undefined,
    false,
    true,
  );
  insert(timeout, timeout._idleTimeout);
  return timeout;
}

/** Run `callback` every `repeat` milliseconds until it is cleared. */
export function setInterval<A extends unknown[]>(
  callback: (...args: A) => void,
  repeat?: number,
  ...args: A
): Timeout {
  validateFunction(callback, "callback");
  const timeout = new Timeout(
    callback as never,
    repeat,
    args.length ? args : undefined,
    true,
    true,
  );
  insert(timeout, timeout._idleTimeout);
  return timeout;
}

/**
 * Cancel an interval.
 *
 * The same function as `clearTimeout`, not merely similar: the HTML standard
 * gives both a single id space, so either clears either. Exported under both
 * names rather than wrapped, so that they are indistinguishable including by
 * identity.
 */
export { clearTimeout, clearTimeout as clearInterval };

/**
 * Run `callback` after the current operation, before the loop waits for I/O.
 *
 * Distinct from `setTimeout(callback, 0)`, which waits for the clock and lands
 * in a different phase. Inside an I/O callback an immediate always runs first.
 */
export function setImmediate<A extends unknown[]>(
  callback: (...args: A) => void,
  ...args: A
): Immediate {
  validateFunction(callback, "callback");
  return new Immediate(callback as never, args.length ? args : undefined);
}

export { clearImmediate };

/**
 * The promise-returning forms.
 *
 * A plain export rather than node's lazy getter. Node defers the load because
 * `timers/promises` requires `timers` back and the cycle has to be broken
 * somewhere; here `promises.ts` imports the machinery directly instead of the
 * public module, so there is no cycle to break.
 */
export { promises };

/**
 * The handle types, for callers that name them.
 *
 * A type-only export: node's `require('timers')` has no `Timeout` property,
 * and adding one would be a difference a test could see. Code that needs the
 * classes themselves imports them from `./timeout.ts` and `./immediate.ts`.
 */
export type { Timeout, Immediate };

/**
 * `util.promisify(setTimeout)` gives the `timers/promises` version.
 *
 * A caller who promisifies the callback form is asking for the awaitable one,
 * and the awaitable one is not what `promisify` would produce: it resolves
 * with the value rather than with the timer handle, and takes a signal. The
 * well-known symbol is how a function says "the promise form of me already
 * exists, use it".
 */
const kCustomPromisify = Symbol.for("nodejs.util.promisify.custom");

Object.defineProperty(setTimeout, kCustomPromisify, {
  enumerable: true,
  value: promises.setTimeout,
});

Object.defineProperty(setImmediate, kCustomPromisify, {
  enumerable: true,
  value: promises.setImmediate,
});
