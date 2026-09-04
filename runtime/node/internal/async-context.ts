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
declare function nts_async_context_get(): object | undefined;

/** Attach `frame` to the current continuation and every one derived from it. */
declare function nts_async_context_set(frame: object | undefined): void;

/**
 * One layer of context: everything the enclosing scope had, plus one change.
 *
 * A `Map` because the keys are the `AsyncLocalStorage` instances themselves,
 * and there can be any number of them independently in play. Copied from the
 * parent rather than chained to it, because reads happen far more often than
 * writes -- every `getStore()` in a request's lifetime against one `run()` --
 * and a chain would make the common operation walk.
 *
 * Frames are never mutated after construction. A scope that could edit the
 * frame it inherited would edit its caller's context too, which is the bug the
 * whole design exists to prevent.
 */
export class AsyncContextFrame extends Map<object, unknown> {
  constructor(store: object, data: unknown) {
    super(AsyncContextFrame.current() as Iterable<[object, unknown]> | undefined);
    this.set(store, data);
  }

  /** The frame the current continuation carries, if any. */
  static current(): AsyncContextFrame | undefined {
    return nts_async_context_get() as AsyncContextFrame | undefined;
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

  /**
   * Forget one storage's value in the current frame.
   *
   * In place, unlike everything else here, and node's `disable()` is the only
   * caller. It is the one operation whose point is to affect contexts that
   * have already been derived -- `disable()` means "this storage is finished",
   * not "this scope is finished".
   */
  static disable(store: object): void {
    AsyncContextFrame.current()?.delete(store);
  }
}
