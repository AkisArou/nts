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
): Timeout<A> {
  validateFunction(callback, "callback");
  const timeout = new Timeout(
    callback,
    after,
    args,
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
): Timeout<A> {
  validateFunction(callback, "callback");
  const timeout = new Timeout(
    callback,
    repeat,
    args,
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
): Immediate<A> {
  validateFunction(callback, "callback");
  return new Immediate(callback, args);
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
 * Raw implementation exports for the conformance harness's node-internal
 * facades. `shape.mjs` deliberately omits these from the public `timers`
 * object. These are export aliases, not forwarding functions, so the facade
 * adds no call on any scheduler path and the compiled lane cannot import
 * TypeScript helpers beside the addon it is measuring.
 *
 * The handle classes remain usable as types as well as values. Node's
 * `require('timers')` has no `Timeout` or `Immediate` property; the explicit
 * public shape is what preserves that contract.
 */
export {
  active,
  cleanTimer,
  decRefCount,
  getTimerDuration,
  insert,
  kRefed,
  setUnrefTimeout,
  TIMEOUT_MAX,
  timerListMap,
  timerListQueue,
  Timeout,
  unrefActive,
} from "./timeout.ts";
export {
  cleanImmediate,
  immediateQueue,
  Immediate,
} from "./immediate.ts";
export {
  append,
  init,
  isEmpty,
  peek,
  remove,
} from "./linkedlist.ts";
export { PriorityQueue } from "./priority-queue.ts";
