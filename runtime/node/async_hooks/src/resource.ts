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
import { deprecate } from "../../internal/deprecate.ts";
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
  kAsyncId,
  kContextFrame,
  kTriggerAsyncId,
  newAsyncId,
  registerDestroyHook,
} from "../../internal/async-hooks.ts";

const kDestroyed = Symbol("destroyed");

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
  declare [kAsyncId]: number;
  declare [kTriggerAsyncId]: number;
  declare [kContextFrame]: AsyncContextFrame | undefined;
  declare [kDestroyed]: { destroyed: boolean } | undefined;

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
    this[kContextFrame] = AsyncContextFrame.current();

    const asyncId = newAsyncId();
    this[kAsyncId] = asyncId;
    this[kTriggerAsyncId] = trigger;

    if (initHooksExist()) {
      // Checked here rather than beside the `validateString` above, because an
      // empty string is only a problem for the hook that has to name the
      // resource; a program with no hooks has no reason to be stopped by it.
      if (type.length === 0) throw new ERR_ASYNC_TYPE(type);
      emitInit(asyncId, type, trigger, this);
    }

    if (!requireManualDestroy && destroyHooksExist()) {
      const state = { destroyed: false };
      this[kDestroyed] = state;
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
  runInAsyncScope<T, A extends unknown[], R>(
    fn: (this: T, ...args: A) => R,
    thisArg?: T,
    ...args: A
  ): R {
    const asyncId = this[kAsyncId];
    emitBefore(asyncId, this[kTriggerAsyncId], this);

    const prior = AsyncContextFrame.exchange(this[kContextFrame]);
    try {
      return Reflect.apply(fn, thisArg, args) as R;
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
    if (this[kDestroyed] !== undefined) {
      // Marked so the collection hook, which may fire long afterwards, does
      // not report the same resource a second time.
      this[kDestroyed].destroyed = true;
    }
    emitDestroy(this[kAsyncId]);
    return this;
  }

  asyncId(): number {
    return this[kAsyncId];
  }

  triggerAsyncId(): number {
    return this[kTriggerAsyncId];
  }

  /**
   * A function that always runs in this resource's scope.
   *
   * The wrapper takes `fn.length` so that code dispatching on arity -- which
   * is most callback-vs-promise detection in the ecosystem -- sees the
   * function that was passed rather than the wrapper.
   */
  bind<A extends unknown[], R>(
    fn: (...args: A) => R,
    thisArg?: unknown,
  ): ((...args: A) => R) & { asyncResource: AsyncResource } {
    validateFunction(fn, "fn");
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    let self: AsyncResource = this;

    const bound = thisArg === undefined
      ? function (this: unknown, ...args: A): R {
          // `this` at the call site, not the one captured here: an unbound
          // method assigned onto an object must still see that object.
          return self.runInAsyncScope(fn as (...a: A) => R, this as never, ...args);
        }
      : (...args: A): R => self.runInAsyncScope(fn as (...a: A) => R, thisArg as never, ...args);

    Object.defineProperties(bound, {
      length: {
        __proto__: null,
        configurable: true,
        enumerable: false,
        value: fn.length,
        writable: false,
      },
      asyncResource: {
        __proto__: null,
        configurable: true,
        enumerable: true,
        get: deprecate(
          function (): unknown { return self; },
          "The asyncResource property on bound functions is deprecated",
          "DEP0172",
        ),
        set: deprecate(
          function (value: never): void { self = value; },
          "The asyncResource property on bound functions is deprecated",
          "DEP0172",
        ),
      },
    } as PropertyDescriptorMap);

    return bound as ((...args: A) => R) & { asyncResource: AsyncResource };
  }

  /** `fn`, wrapped in a resource of its own. */
  static bind<A extends unknown[], R>(
    fn: (...args: A) => R,
    type?: string,
    thisArg?: unknown,
  ): ((...args: A) => R) & { asyncResource: AsyncResource } {
    if (typeof fn !== "function") throw new ERR_INVALID_ARG_TYPE("fn", "function", fn);
    // Named after the function when the caller did not say, because the type
    // is what a hook has to identify the resource by and `bound-anonymous-fn`
    // twenty times over tells nobody anything.
    const name = type || fn.name;
    return new AsyncResource(name || "bound-anonymous-fn").bind(fn, thisArg);
  }
}
