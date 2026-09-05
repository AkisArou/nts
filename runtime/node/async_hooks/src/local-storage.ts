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
import {
  AsyncContextFrame,
  type AsyncContextEntry,
} from "../../internal/async-context.ts";
import { AsyncResource } from "./resource.ts";

export interface AsyncLocalStorageOptions<T = unknown> {
  /** What `getStore()` answers outside any `run`. */
  defaultValue?: T | undefined;
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
export class RunScope {
  #restore: () => void;
  #disposed = false;

  constructor(restore: () => void) {
    this.#restore = restore;
  }

  dispose(): void {
    // Idempotent because an explicit `dispose()` inside a `using` block is
    // legitimate, and the automatic one will still come afterwards.
    if (this.#disposed) return;
    this.#disposed = true;
    this.#restore();
  }
}

interface StoredContext<T> {
  value: T | undefined;
}

let nextStorageId = 1;

/**
 * One type-preserving entry in an `AsyncContextFrame` snapshot.
 *
 * The frame deliberately cannot inspect `StoredContext<T>`. This object keeps
 * that type paired with the storage's own weak map all the way through a
 * clone, so no `unknown` value or type assertion is needed.
 */
class StorageContextEntry<T> implements AsyncContextEntry {
  #storageId: number;
  #contexts: WeakMap<AsyncContextFrame, StoredContext<T>>;
  #stored: StoredContext<T>;

  constructor(
    storageId: number,
    contexts: WeakMap<AsyncContextFrame, StoredContext<T>>,
    stored: StoredContext<T>,
  ) {
    this.#storageId = storageId;
    this.#contexts = contexts;
    this.#stored = stored;
  }

  storageId(): number {
    return this.#storageId;
  }

  install(frame: AsyncContextFrame): void {
    this.#contexts.set(frame, this.#stored);
  }

  remove(frame: AsyncContextFrame): void {
    this.#contexts.delete(frame);
  }
}

export class AsyncLocalStorage<T = unknown> {
  #defaultValue: T | undefined;
  #name: string | undefined;
  #storageId: number;
  #contexts = new WeakMap<AsyncContextFrame, StoredContext<T>>();

  constructor(options: AsyncLocalStorageOptions<T> = {}) {
    validateObject(options, "options");
    this.#storageId = nextStorageId;
    nextStorageId += 1;
    this.#defaultValue = options.defaultValue;
    if (options.name !== undefined) this.#name = `${options.name}`;
  }

  get name(): string {
    return this.#name || "";
  }

  /** `fn`, pinned to the context it was bound in. */
  static bind<T, A extends unknown[], R>(
    fn: (this: T, ...args: A) => R,
  ): (this: T, ...args: A) => R {
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
   * Remove this storage from the current continuation's shared snapshot.
   * Existing asynchronous work carrying that same snapshot sees the removal;
   * independent snapshots retain their own state, matching Node's map model.
   */
  disable(): void {
    AsyncContextFrame.current()?.removeEntry(this.#storageId);
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
    this.#enterStore(store);
  }

  #enterStore(store: T | undefined): void {
    const frame = new AsyncContextFrame();
    const stored: StoredContext<T> = { value: store };
    frame.setEntry(new StorageContextEntry(this.#storageId, this.#contexts, stored));
    AsyncContextFrame.setCurrent(frame);
  }

  /**
   * Run `fn` with `store` in place, and restore what was there afterwards.
   */
  run<A extends unknown[], R>(
    store: T,
    fn: (this: null, ...args: A) => R,
    ...args: A
  ): R {
    return this.#runStore(store, fn, args);
  }

  #runStore<A extends unknown[], R>(
    store: T | undefined,
    fn: (this: null, ...args: A) => R,
    args: A,
  ): R {
    const prior = this.getStore();
    // Setting the same value would allocate a frame that changes nothing, and
    // `run` nested inside `run` with one store is common enough to be worth
    // the comparison. `Object.is`, so that re-entering with `NaN` is also a
    // no-op and re-entering with `-0` over `0` is not.
    if (Object.is(prior, store)) return fn.call(null, ...args);

    this.#enterStore(store);
    try {
      return fn.call(null, ...args);
    } finally {
      // A new frame carrying the old value, rather than the old frame. They
      // differ when `fn` changed some *other* storage with `enterWith`: those
      // changes are meant to outlive this call, and reinstating the old frame
      // would undo them.
      this.#enterStore(prior);
    }
  }

  /** Run `fn` with this storage unset, whatever it was. */
  exit<A extends unknown[], R>(fn: (this: null, ...args: A) => R, ...args: A): R {
    return this.#runStore(undefined, fn, args);
  }

  getStore(): T | undefined {
    const current = AsyncContextFrame.current();
    if (current === undefined) return this.#defaultValue;
    const stored = this.#contexts.get(current);
    return stored === undefined ? this.#defaultValue : stored.value;
  }

  withScope(store: T): RunScope {
    const previous = this.getStore();
    this.#enterStore(store);
    return new RunScope(() => this.#enterStore(previous));
  }
}
