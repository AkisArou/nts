// `AsyncResource`, from node v24.20.0 `lib/async_hooks.js`.
//
// The thing a library reaches for when it holds a callback across a gap the
// runtime cannot see. A connection pool that queues a callback and runs it when
// a socket frees up has broken the chain by hand: as far as the runtime is
// concerned the callback runs from whichever request happened to release the
// socket, so a request id set by the *original* caller would be gone, and a
// hook would attribute the work to a stranger.
//
// An `AsyncResource` closes that gap. It captures the context where it was
// created and `runInAsyncScope` restores it, which is the same pair of
// operations the runtime performs for a timer or a socket read -- made
// available to code that is scheduling its own work.

import {
  ERR_ASYNC_TYPE,
  ERR_INVALID_ARG_TYPE,
  ERR_INVALID_ASYNC_ID,
} from "../../internal/errors.ts";
import { validateFunction, validateString } from "../../internal/validators.ts";
import { AsyncContextFrame } from "../../internal/async-context.ts";
import {
  destroyHooksExist,
  emitAfter,
  emitBefore,
  emitDestroy,
  emitInit,
  getDefaultTriggerAsyncId,
  hasAsyncIdStack,
  initHooksExist,
  newAsyncId,
  registerDestroyHook,
} from "../../internal/async-hooks.ts";

export interface AsyncResourceOptions {
  triggerAsyncId?: number | undefined;
  /**
   * Suppress the automatic `destroy` on collection.
   *
   * For a resource whose end the program knows and the collector does not --
   * a pooled object that outlives its usefulness, say. The cost of asking is
   * that forgetting to call `emitDestroy()` leaks the id: nothing else will
   * ever report it finished.
   */
  requireManualDestroy?: boolean | undefined;
}

export class AsyncResource {
  #asyncId: number;
  #triggerAsyncId: number;
  #contextFrame: AsyncContextFrame | undefined;
  #destroyState: { destroyed: boolean } | undefined;

  constructor(type: string, options: AsyncResourceOptions | number = {}) {
    validateString(type, "type");

    let trigger: number;
    let requireManualDestroy = false;
    if (typeof options === "number") {
      // The bare-number form is older than the options object and still in
      // use; it means `triggerAsyncId` and nothing else.
      trigger = options;
    } else {
      trigger = options.triggerAsyncId === undefined
        ? getDefaultTriggerAsyncId()
        : options.triggerAsyncId;
      requireManualDestroy = !!options.requireManualDestroy;
    }

    if (!Number.isSafeInteger(trigger) || trigger < -1) {
      throw new ERR_INVALID_ASYNC_ID("triggerAsyncId", trigger);
    }

    // Captured at construction, not at first use. The point of the class is
    // that the context of the code that *set up* the work is the one restored,
    // and by the time anyone calls `runInAsyncScope` that code has returned.
    this.#contextFrame = AsyncContextFrame.current();

    const asyncId = newAsyncId();
    this.#asyncId = asyncId;
    this.#triggerAsyncId = trigger;
    this.#destroyState = undefined;

    if (initHooksExist()) {
      // Checked here rather than beside the `validateString` above, because an
      // empty string is only a problem for the hook that has to name the
      // resource; a program with no hooks has no reason to be stopped by it.
      if (type.length === 0) throw new ERR_ASYNC_TYPE(type);
      emitInit(asyncId, type, trigger, this);
    }

    if (!requireManualDestroy && destroyHooksExist()) {
      const state = { destroyed: false };
      this.#destroyState = state;
      registerDestroyHook(this, asyncId, state);
    }
  }

  /**
   * Run `fn` as though it were the continuation of this resource.
   *
   * Both halves of the context are restored: the ids a hook reads, and the
   * frame an `AsyncLocalStorage` reads. Restoring only one would produce the
   * confusing case where a hook and a store disagree about which request they
   * are in.
   */
  runInAsyncScope<A extends unknown[], R>(
    fn: (this: void, ...args: A) => R,
    thisArg?: undefined,
    ...args: A
  ): R;
  runInAsyncScope<T, A extends unknown[], R>(
    fn: (this: T, ...args: A) => R,
    thisArg: T,
    ...args: A
  ): R;
  runInAsyncScope<A extends unknown[], R>(
    fn: (...args: A) => R,
    thisArg?: unknown,
    ...args: A
  ): R {
    validateFunction(fn, "fn");
    const asyncId = this.#asyncId;
    emitBefore(asyncId, this.#triggerAsyncId, this);

    const prior = AsyncContextFrame.exchange(this.#contextFrame);
    try {
      // The overloads preserve the relationship between a callback's declared
      // receiver and a present receiver. The implementation sees `unknown`
      // because JavaScript also permits the receiver to be omitted, in which
      // case Function#call supplies strict-mode `undefined` exactly.
      return fn.call(thisArg, ...args);
    } finally {
      AsyncContextFrame.setCurrent(prior);
      // A hook disabled inside `fn` can empty the stack, and emitting an
      // `after` for a frame that is no longer there would unbalance the next
      // pop rather than this one.
      if (hasAsyncIdStack()) emitAfter(asyncId);
    }
  }

  /** Report this resource finished. */
  emitDestroy(): this {
    if (this.#destroyState !== undefined) {
      // Marked so the collection hook, which may fire long afterwards, does
      // not report the same resource a second time.
      this.#destroyState.destroyed = true;
    }
    emitDestroy(this.#asyncId);
    return this;
  }

  asyncId(): number {
    return this.#asyncId;
  }

  triggerAsyncId(): number {
    return this.#triggerAsyncId;
  }

  /**
   * A function that always runs in this resource's scope.
   *
   * Node also exposes the deprecated `asyncResource` property and copies
   * `fn.length` onto the wrapper. Functions are not property-bearing objects
   * in NTS, so those §13 metadata operations are deliberately absent.
   */
  bind<T, A extends unknown[], R>(
    fn: (this: T, ...args: A) => R,
    thisArg?: T,
  ): (this: T, ...args: A) => R {
    validateFunction(fn, "fn");
    const self = this;

    return thisArg === undefined
      ? function (this: T, ...args: A): R {
          // `this` at the call site, not the one captured here: an unbound
          // method assigned onto an object must still see that object.
          return self.runInAsyncScope(fn, this, ...args);
        }
      : (...args: A): R => self.runInAsyncScope(fn, thisArg, ...args);
  }

  /** `fn`, wrapped in a resource of its own. */
  static bind<T, A extends unknown[], R>(
    fn: (this: T, ...args: A) => R,
    type?: string,
    thisArg?: T,
  ): (this: T, ...args: A) => R {
    if (typeof fn !== "function") throw new ERR_INVALID_ARG_TYPE("fn", "function", fn);
    return new AsyncResource(type || "bound-anonymous-fn").bind(fn, thisArg);
  }
}
