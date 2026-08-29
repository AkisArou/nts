// `process.nextTick`, without `node:process`.
//
// A callback that must run after the current operation finishes but before any
// I/O. Node keeps its own queue, drained between phases of the event loop;
// until `node:process` exists this is the one binding that stands for it, and
// this file goes away when it does.

import { AsyncContextFrame } from "./async-context.ts";
import {
  emitAfter,
  emitBefore,
  emitDestroy,
  emitInit,
  getDefaultTriggerAsyncId,
  initHooksExist,
  kAsyncId,
  kTriggerAsyncId,
  newAsyncId,
} from "./async-hooks.ts";

/** Queue `callback` to run once the current stack unwinds. */
declare function nts_next_tick(callback: (...args: never) => void, args: unknown[]): void;

/**
 * Queue `callback`, carrying the current context to it.
 *
 * The wrapper is not free and is not optional. A tick is a gap the engine does
 * not bridge: unlike a promise continuation, nothing links the callback to the
 * code that scheduled it, so the asynchronous context has to be picked up here
 * and put back there by hand. Anything reading `AsyncLocalStorage` inside a
 * `nextTick` depends on this, and so does every hook that wants to see one.
 *
 * The arguments still travel beside the callback rather than in the closure,
 * because the queue passes them through and copying them here would be a
 * second array for no gain.
 */
export function nextTick<A extends unknown[]>(
  callback: (...args: A) => void,
  ...args: A
): void {
  const asyncId = newAsyncId();
  const trigger = getDefaultTriggerAsyncId();
  const frame = AsyncContextFrame.current();

  // Node calls this a TickObject and hands it to hooks as the resource. It
  // carries the ids and the work, which is all a hook is shown of it.
  const resource = {
    [kAsyncId]: asyncId,
    [kTriggerAsyncId]: trigger,
    callback,
    args,
  };
  if (initHooksExist()) emitInit(asyncId, "TickObject", trigger, resource);

  nts_next_tick(
    ((...received: never) => {
      const prior = AsyncContextFrame.exchange(frame);
      emitBefore(asyncId, trigger, resource);
      try {
        (callback as (...a: unknown[]) => void)(...(received as unknown as unknown[]));
      } finally {
        // In this order: `after` closes the scope the callback ran in, and
        // `destroy` says the tick is finished. Reversing them would report a
        // resource destroyed while its own scope was still open.
        emitAfter(asyncId);
        emitDestroy(asyncId);
        AsyncContextFrame.setCurrent(prior);
      }
    }) as (...a: never) => void,
    args,
  );
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
