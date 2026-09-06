// The object node's tests see as `require('timers')`, and the globals.
//
// Almost every test reaches for the globals rather than the module: nobody
// writes `require('timers').setTimeout`. Installing them is therefore not a
// convenience but the main path, and the module export is the secondary one.

export function shape(exports) {
  // `timers/promises` is imported as an ESM namespace, whose enumerable keys
  // are sorted. Node's CommonJS subpath installs the three operations first
  // and the scheduler object last; preserve both that observable order and
  // identity with the value exposed through `timers.promises`.
  const promises = {
    setTimeout: exports.promises.setTimeout,
    setImmediate: exports.promises.setImmediate,
    setInterval: exports.promises.setInterval,
    scheduler: exports.promises.scheduler,
  };
  return {
    setTimeout: exports.setTimeout,
    clearTimeout: exports.clearTimeout,
    setImmediate: exports.setImmediate,
    clearImmediate: exports.clearImmediate,
    setInterval: exports.setInterval,
    clearInterval: exports.clearInterval,
    promises,
  };
}

/** The promise-returning timer API is a public Node subpath. */
export function subpaths(_exports, underTest) {
  return { "timers/promises": underTest.promises };
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
 * Routed through hidden raw entry exports rather than source imports. The
 * public shape above omits them, so `require('timers')` still has exactly
 * node's seven names while the compiled lane uses only the addon it loaded.
 */
export function internals(exports) {
  return {
    "internal/linkedlist": {
      append: exports.append,
      init: exports.init,
      isEmpty: exports.isEmpty,
      peek: exports.peek,
      remove: exports.remove,
    },
    "internal/priority_queue": exports.PriorityQueue,
    "internal/timers": {
      TIMEOUT_MAX: exports.TIMEOUT_MAX,
      Timeout: exports.Timeout,
      Immediate: exports.Immediate,
      insert: exports.insert,
      active: exports.active,
      unrefActive: exports.unrefActive,
      setUnrefTimeout: exports.setUnrefTimeout,
      getTimerDuration: exports.getTimerDuration,
      cleanTimer: exports.cleanTimer,
      cleanImmediate: exports.cleanImmediate,
      timerListMap: exports.timerListMap,
      timerListQueue: exports.timerListQueue,
      immediateQueue: exports.immediateQueue,
      kRefed: exports.kRefed,
      decRefCount: exports.decRefCount,
    },
  };
}

/** Private binding surface used by applicable upstream timer fixtures. */
export function testBindings(exports) {
  return {
    timers: {
      getLibuvNow: exports.now,
    },
  };
}
