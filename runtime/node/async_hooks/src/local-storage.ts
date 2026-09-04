// `AsyncLocalStorage`, from node v24.20.0
// `lib/internal/async_local_storage/async_context_frame.js`.
//
// A variable whose value depends on which asynchronous operation is asking.
// The motivating case is a server: a request id, a user, a transaction --
// something every layer of the handler needs and none of them should have to
// thread through their signatures. A module-level variable cannot do it,
// because the whole point of a server is that several requests are in flight
// at once and a plain variable would hold whichever one started most recently.
//
// The class is nearly free of machinery: it is a key into the context frame,
// and the frame is what does the work. That is deliberate -- an instance holds
// no stores, so a storage that goes out of scope takes nothing with it, and
// the values live exactly as long as the asynchronous work they belong to.

import { validateObject } from "../../internal/validators.ts";
import { AsyncContextFrame } from "../../internal/async-context.ts";
import { AsyncResource } from "./resource.ts";

export interface AsyncLocalStorageOptions {
  /** What `getStore()` answers outside any `run`. */
  defaultValue?: unknown;
  /** A label, for a program holding several. */
  name?: string | undefined;
}

/**
 * A `run` that ends when the block does.
 *
 * For `using scope = storage.withScope(store)`, where the restore happens on
 * the way out of the block rather than at the end of a callback. It exists
 * because `run(store, () => { ... })` forces the body into a function, and a
 * function body cannot `await` on behalf of its caller or `return` from it.
 */
export class RunScope<T> {
  #storage: AsyncLocalStorage<T>;
  #previous: T | undefined;
  #disposed = false;

  constructor(storage: AsyncLocalStorage<T>, store: T) {
    this.#storage = storage;
    this.#previous = storage.getStore();
    storage.enterWith(store);
  }

  dispose(): void {
    // Idempotent because an explicit `dispose()` inside a `using` block is
    // legitimate, and the automatic one will still come afterwards.
    if (this.#disposed) return;
    this.#disposed = true;
    this.#storage.enterWith(this.#previous as T);
  }

  [Symbol.dispose](): void {
    this.dispose();
  }
}

export class AsyncLocalStorage<T = unknown> {
  #defaultValue: T | undefined;
  #name: string | undefined;

  constructor(options: AsyncLocalStorageOptions = {}) {
    validateObject(options, "options");
    this.#defaultValue = options.defaultValue as T | undefined;
    if (options.name !== undefined) this.#name = `${options.name}`;
  }

  get name(): string {
    return this.#name || "";
  }

  /** `fn`, pinned to the context it was bound in. */
  static bind<A extends unknown[], R>(fn: (...args: A) => R): (...args: A) => R {
    return AsyncResource.bind(fn);
  }

  /**
   * A function that runs anything in the context current *now*.
   *
   * The indirection is the point: a snapshot is taken once and used to run
   * many different callbacks later, where `bind` pins one callback. A worker
   * draining a queue wants this -- the context belongs to when the queue was
   * set up, not to whichever job is passing through.
   */
  static snapshot(): <A extends unknown[], R>(fn: (...args: A) => R, ...args: A) => R {
    return AsyncLocalStorage.bind(
      <A extends unknown[], R>(fn: (...args: A) => R, ...args: A): R => fn(...args),
    );
  }

  /**
   * Stop this storage answering anywhere.
   *
   * Reaches into contexts already derived, unlike everything else here: it
   * means "this storage is finished", not "this scope is finished". A `run`
   * that is still on the stack will find the value gone.
   */
  disable(): void {
    AsyncContextFrame.disable(this);
  }

  /**
   * Set the store for the rest of the current context.
   *
   * No matching exit. Everything already scheduled keeps the old value and
   * everything scheduled after this gets the new one, which makes it the tool
   * for a place with no enclosing callback to hang a `run` on -- the middle of
   * a request parser, say. `run` is the safer form and should be preferred.
   */
  enterWith(store: T): void {
    AsyncContextFrame.setCurrent(new AsyncContextFrame(this, store));
  }

  /**
   * Run `fn` with `store` in place, and restore what was there afterwards.
   */
  run<A extends unknown[], R>(store: T, fn: (...args: A) => R, ...args: A): R {
    const prior = this.getStore();
    // Setting the same value would allocate a frame that changes nothing, and
    // `run` nested inside `run` with one store is common enough to be worth
    // the comparison. `Object.is`, so that re-entering with `NaN` is also a
    // no-op and re-entering with `-0` over `0` is not.
    if (Object.is(prior, store)) return fn(...args);

    this.enterWith(store);
    try {
      return fn(...args);
    } finally {
      // A new frame carrying the old value, rather than the old frame. They
      // differ when `fn` changed some *other* storage with `enterWith`: those
      // changes are meant to outlive this call, and reinstating the old frame
      // would undo them.
      this.enterWith(prior as T);
    }
  }

  /** Run `fn` with this storage unset, whatever it was. */
  exit<A extends unknown[], R>(fn: (...args: A) => R, ...args: A): R {
    return this.run(undefined as T, fn, ...args);
  }

  getStore(): T | undefined {
    const frame = AsyncContextFrame.current();
    // `has` rather than a truthiness test on the value: a store explicitly set
    // to `undefined` is a value, and answering the default there would make
    // `run(undefined, ...)` indistinguishable from never having run at all.
    if (!frame?.has(this)) return this.#defaultValue;
    return frame.get(this) as T;
  }

  withScope(store: T): RunScope<T> {
    return new RunScope(this, store);
  }
}
