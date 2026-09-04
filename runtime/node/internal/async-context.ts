// The carrier that makes `AsyncLocalStorage` work, from node v24.20.0
// `lib/internal/async_context_frame.js`.
//
// The problem this solves is that a value has to survive an `await`. A program
// that sets a request id, awaits a database call, and then logs, expects the
// log to know which request it was -- but the code after the `await` runs from
// a microtask with nothing linking it to the code before, and a plain variable
// would hold whichever request most recently *started*.
//
// The answer is not JavaScript's to give: something has to travel with the
// continuation itself, which only the engine can arrange. V8 calls the slot
// continuation-preserved embedder data, and it is the whole of the machinery
// here -- everything else is a map, kept immutable so that entering a scope
// cannot disturb the scope it was entered from.
//
// Node has this behind `--async-context-frame` with an older `async_hooks`
// implementation beside it. The flag defaults on in v24 and the older path
// exists to be switched back to, which is not a reason for a second
// implementation here, so this is the only one.

/**
 * Read the frame attached to the current continuation.
 *
 * Returns whatever `set` was last given *on this continuation* -- not the last
 * call in wall-clock order, which is exactly the distinction that makes this a
 * VM primitive rather than a variable.
 */
declare function nts_async_context_get(): AsyncContextFrame | undefined;

/** Attach `frame` to the current continuation and every one derived from it. */
declare function nts_async_context_set(frame: AsyncContextFrame | undefined): void;

/**
 * A detached snapshot of every storage active on one continuation.
 *
 * Node uses a `Map<AsyncLocalStorage, unknown>` and clones it when a storage
 * changes. A heterogeneous map would throw away the relationship between a
 * storage's `T` and its value here. Instead, each immutable entry knows how to
 * install its own correctly typed value into the new frame. The frame only
 * handles entry identity and copying; it never reads an erased store value.
 *
 * Entries are shared by snapshots until their storage changes. Sharing is
 * safe because an entry is immutable, and it matters for `run()`: restoring
 * one storage must preserve changes made to other storages inside the call,
 * without retaining the frame that held the temporary store.
 */
export interface AsyncContextEntry {
  storageId(): number;
  install(frame: AsyncContextFrame): void;
  remove(frame: AsyncContextFrame): void;
}

export class AsyncContextFrame {
  #entries: Array<AsyncContextEntry | undefined>;
  #entryCount: number;

  constructor() {
    this.#entries = new Array<AsyncContextEntry | undefined>(4);
    this.#entryCount = 0;

    const source = AsyncContextFrame.current();
    if (source !== undefined) source.#copyInto(this);
  }

  /** Add or replace one storage's immutable typed entry. */
  setEntry(entry: AsyncContextEntry): void {
    const storageId = entry.storageId();
    for (let index = 0; index < this.#entryCount; index += 1) {
      const current = this.#entries[index];
      if (current !== undefined && current.storageId() === storageId) {
        this.#entries[index] = entry;
        entry.install(this);
        return;
      }
    }

    if (this.#entryCount === this.#entries.length) this.#grow();
    this.#entries[this.#entryCount] = entry;
    this.#entryCount += 1;
    entry.install(this);
  }

  /** Remove one storage from this continuation's snapshot. */
  removeEntry(storageId: number): void {
    for (let index = 0; index < this.#entryCount; index += 1) {
      const entry = this.#entries[index];
      if (entry === undefined || entry.storageId() !== storageId) continue;

      entry.remove(this);
      for (let next = index + 1; next < this.#entryCount; next += 1) {
        this.#entries[next - 1] = this.#entries[next];
      }
      this.#entryCount -= 1;
      this.#entries[this.#entryCount] = undefined;
      return;
    }
  }

  #copyInto(target: AsyncContextFrame): void {
    if (target.#entries.length < this.#entries.length) {
      target.#entries = new Array<AsyncContextEntry | undefined>(this.#entries.length);
    }
    target.#entryCount = this.#entryCount;
    for (let index = 0; index < this.#entryCount; index += 1) {
      const entry = this.#entries[index];
      target.#entries[index] = entry;
      if (entry !== undefined) entry.install(target);
    }
  }

  #grow(): void {
    const larger = new Array<AsyncContextEntry | undefined>(this.#entries.length * 2);
    for (let index = 0; index < this.#entryCount; index += 1) {
      larger[index] = this.#entries[index];
    }
    this.#entries = larger;
  }

  /** The frame the current continuation carries, if any. */
  static current(): AsyncContextFrame | undefined {
    return nts_async_context_get();
  }

  /** Make `frame` the context from here forward. */
  static setCurrent(frame: AsyncContextFrame | undefined): void {
    nts_async_context_set(frame);
  }

  /** Install `frame` and hand back what it replaced, for restoring later. */
  static exchange(frame: AsyncContextFrame | undefined): AsyncContextFrame | undefined {
    const prior = AsyncContextFrame.current();
    AsyncContextFrame.setCurrent(frame);
    return prior;
  }

}
