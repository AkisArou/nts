// The object node's tests see as `require('timers')`, and the globals.
//
// Almost every test reaches for the globals rather than the module: nobody
// writes `require('timers').setTimeout`. Installing them is therefore not a
// convenience but the main path, and the module export is the secondary one.

import * as linkedlist from "./src/linkedlist.ts";
import { PriorityQueue } from "./src/priority-queue.ts";
import * as timeout from "./src/timeout.ts";
import * as immediate from "./src/immediate.ts";

export function shape(exports) {
  const timers = { ...exports };
  delete timers.default;
  return timers;
}

/**
 * Replace the scheduling globals with ours.
 *
 * All six together. Half-replacing would be worse than not replacing at all:
 * a `setTimeout` of ours cancelled by node's `clearTimeout` would look like a
 * timer that fires after being cleared, and the failure would point at the
 * timer rather than at the mismatch.
 */
export function installGlobals(timers) {
  globalThis.setTimeout = timers.setTimeout;
  globalThis.clearTimeout = timers.clearTimeout;
  globalThis.setInterval = timers.setInterval;
  globalThis.clearInterval = timers.clearInterval;
  globalThis.setImmediate = timers.setImmediate;
  globalThis.clearImmediate = timers.clearImmediate;
}

/**
 * The node-internal module ids these files stand in for.
 *
 * Imported from the source directly rather than routed through the public
 * module, so that `require('timers')` keeps exactly node's shape -- node's has
 * no `Timeout` property and no linked list on it, and a test that enumerates
 * the module would see the difference.
 */
export function internals() {
  return {
    "internal/linkedlist": linkedlist,
    "internal/priority_queue": PriorityQueue,
    "internal/timers": {
      TIMEOUT_MAX: timeout.TIMEOUT_MAX,
      Timeout: timeout.Timeout,
      Immediate: immediate.Immediate,
      insert: timeout.insert,
      active: timeout.active,
      unrefActive: timeout.unrefActive,
      setUnrefTimeout: timeout.setUnrefTimeout,
      getTimerDuration: timeout.getTimerDuration,
      cleanTimer: timeout.cleanTimer,
      cleanImmediate: immediate.cleanImmediate,
      timerListMap: timeout.timerListMap,
      timerListQueue: timeout.timerListQueue,
      immediateQueue: immediate.immediateQueue,
      knownTimersById: timeout.knownTimersById,
      kRefed: timeout.kRefed,
      kHasPrimitive: timeout.kHasPrimitive,
      decRefCount: timeout.decRefCount,
    },
  };
}
