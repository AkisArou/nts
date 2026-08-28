// `process.nextTick`, without `node:process`.
//
// A callback that must run after the current operation finishes but before any
// I/O. Node keeps its own queue, drained between phases of the event loop;
// until `node:process` exists this is the one binding that stands for it, and
// this file goes away when it does.

/** Queue `callback` to run once the current stack unwinds. */
declare function nts_next_tick(callback: (...args: never) => void, args: unknown[]): void;

/**
 * The arguments travel beside the callback rather than in a closure, because
 * the queue calls the callback itself: a wrapper would put its own frame
 * between the tick and the callback, and node's tests read that stack.
 */
export function nextTick<A extends unknown[]>(
  callback: (...args: A) => void,
  ...args: A
): void {
  nts_next_tick(callback as unknown as (...a: never) => void, args);
}

/**
 * Report an error that has nowhere to go.
 *
 * A subscriber that throws must not take down the publisher -- the publisher
 * did nothing wrong -- but the error must not vanish either. Node re-raises it
 * on the next tick, where it becomes an uncaught exception with the usual
 * handling.
 */
export function triggerUncaughtException(err: unknown): void {
  nextTick(() => {
    throw err;
  });
}
