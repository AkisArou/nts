// Taking a stream apart, from node v24.20.0 `lib/internal/streams/destroy.js`.
//
// `destroy` is the one operation both halves share, and the ordering it
// enforces is the whole file. A stream that is being destroyed must:
//
//   - become destroyed *before* any callback runs, so that a `destroy` called
//     from inside one of those callbacks is a no-op rather than a second
//     teardown;
//   - emit `error` before `close`, and each at most once, so a listener that
//     cleans up on `close` has already seen why;
//   - emit both on a later tick, so a stream constructed and destroyed in the
//     same statement still reaches the listener the caller is about to add.
//
// The last one is why almost everything here goes through `nextTick`. A
// synchronous `error` from a constructor is an error nobody can catch.
//
// Node reads the packed state bits inline here -- `(w[kState] & kDestroyed)`.
// This uses the named accessors instead, which are defined over exactly those
// bits, so it is the same load and mask with the name attached.

import { aggregateTwoErrors, AbortError, ERR_MULTIPLE_CALLBACK } from "../../internal/errors.ts";
import { nextTick } from "../../internal/tick.ts";
import {
  isDestroyed,
  isFinished,
  isServerRequest,
  kIsDestroyed,
} from "./utils.ts";

/** The state fields teardown touches. Both halves' states have these. */
export interface DestroyState {
  constructed: boolean;
  destroyed: boolean;
  closed: boolean;
  closeEmitted: boolean;
  emitClose: boolean;
  autoDestroy: boolean;
  errored: unknown;
  errorEmitted: boolean;
  readable?: boolean;
  writable?: boolean;
  ended?: boolean;
  ending?: boolean;
  endEmitted?: boolean;
  reading?: boolean;
  finished?: boolean;
  finalCalled?: boolean;
  prefinished?: boolean;
}

export interface DestroyableStream {
  _readableState?: DestroyState;
  _writableState?: DestroyState;
  destroyed?: boolean;
  _destroy(error: unknown, callback: (error?: unknown) => void): void;
  _construct?(callback: (error?: unknown) => void): void;
  emit(event: string | symbol, ...args: unknown[]): boolean;
  once<Args extends unknown[]>(
    event: string | symbol,
    listener: (...args: Args) => unknown,
  ): unknown;
  listenerCount(event: string | symbol): number;
  destroy(error?: unknown): unknown;
}

/** Minimal surface needed when an already-existing stream reports an error. */
export interface ErrorState {
  autoDestroy?: boolean;
  destroyed?: boolean;
  errored?: unknown;
  errorEmitted?: boolean;
}

export interface ErrorOrDestroyStream {
  _readableState?: ErrorState;
  _writableState?: ErrorState;
  emit(event: string | symbol, ...args: unknown[]): boolean;
  destroy?(error?: unknown): unknown;
}

/** Deferred teardown, for a stream destroyed while still constructing. */
export const kDestroy = Symbol("kDestroy");
export const kConstruct = Symbol("kConstruct");

/**
 * Record the error on whichever sides exist, without overwriting an earlier
 * one.
 *
 * The first error is the one that explains the failure; a later one is usually
 * a consequence. Reading `err.stack` looks pointless and is not: V8 builds the
 * stack lazily, and an error object that outlives the frames it refers to
 * without ever being asked keeps them alive.
 */
function recordError(error: unknown, w?: DestroyState, r?: DestroyState): void {
  if (!error) return;
  if (error instanceof Error) void error.stack;
  if (w && !w.errored) w.errored = error;
  if (r && !r.errored) r.errored = error;
}

export function destroy(
  stream: DestroyableStream,
  error?: unknown,
  callback?: (error?: unknown) => void,
): DestroyableStream {
  const r = stream._readableState;
  const w = stream._writableState;
  // A duplex keeps the shared answer on its writable side.
  const state = w ?? r;

  if (w?.destroyed || r?.destroyed) {
    if (typeof callback === "function") callback();
    return stream;
  }

  // Marked destroyed before any callback runs, so that a `destroy` from inside
  // one of them returns above rather than tearing down twice.
  recordError(error, w, r);
  if (w) w.destroyed = true;
  if (r) r.destroyed = true;

  if (state && !state.constructed) {
    // Still constructing. `_destroy` must not run before `_construct` has
    // finished, or it would be dismantling something half-built; both errors
    // are kept, since the construction failure explains the state the
    // teardown found.
    const onConstructed = (constructionError: unknown): void => {
      runDestroy(stream, aggregateTwoErrors(constructionError, error), callback);
    };
    stream.once(kDestroy, onConstructed);
  } else {
    runDestroy(stream, error, callback);
  }

  return stream;
}

function runDestroy(
  self: DestroyableStream,
  error: unknown,
  callback?: (error?: unknown) => void,
): void {
  let called = false;

  const onDestroy = (destroyError?: unknown): void => {
    // A `_destroy` that calls back twice is a bug in that stream, and the
    // second call is ignored rather than run: the close events have already
    // been scheduled and emitting them again would be worse.
    if (called) return;
    called = true;

    const r = self._readableState;
    const w = self._writableState;

    recordError(destroyError, w, r);
    if (w) w.closed = true;
    if (r) r.closed = true;

    if (typeof callback === "function") callback(destroyError);

    if (destroyError) {
      nextTick(emitErrorClose, self, destroyError);
    } else {
      nextTick(emitClose, self);
    }
  };

  try {
    self._destroy(error ?? null, onDestroy);
  } catch (thrown) {
    // A `_destroy` that throws instead of calling back is treated as one that
    // called back with the error. There is nowhere else for it to go.
    onDestroy(thrown);
  }
}

function emitErrorClose(self: DestroyableStream, error: unknown): void {
  emitError(self, error);
  emitClose(self);
}

function emitClose(self: DestroyableStream): void {
  const r = self._readableState;
  const w = self._writableState;

  if (w) w.closeEmitted = true;
  if (r) r.closeEmitted = true;

  if (w?.emitClose || r?.emitClose) self.emit("close");
}

function emitError(self: ErrorOrDestroyStream, error: unknown): void {
  const r = self._readableState;
  const w = self._writableState;

  // At most once across both halves. A duplex that failed has one failure,
  // and emitting `error` twice would make every `once('error')` handler in
  // the ecosystem wrong about how many it needs.
  if (w?.errorEmitted || r?.errorEmitted) return;

  if (w) w.errorEmitted = true;
  if (r) r.errorEmitted = true;

  self.emit("error", error);
}

/**
 * Put a destroyed stream back into its initial state.
 *
 * Node exposes this for reusable streams -- a socket returned to a pool. It
 * does not undo the *data*, only the flags, so it is only correct for a stream
 * whose underlying resource is genuinely fresh again.
 */
export function undestroy(stream: DestroyableStream): void {
  const r = stream._readableState;
  const w = stream._writableState;

  if (r) {
    r.constructed = true;
    r.closed = false;
    r.closeEmitted = false;
    r.destroyed = false;
    r.errored = null;
    r.errorEmitted = false;
    r.reading = false;
    // A stream that was never readable stays not-readable: reviving it would
    // give it an end it never had.
    r.ended = r.readable === false;
    r.endEmitted = r.readable === false;
  }

  if (w) {
    w.constructed = true;
    w.destroyed = false;
    w.closed = false;
    w.closeEmitted = false;
    w.errored = null;
    w.errorEmitted = false;
    w.finalCalled = false;
    w.prefinished = false;
    w.ended = w.writable === false;
    w.ending = w.writable === false;
    w.finished = w.writable === false;
  }
}

/**
 * Fail the stream, destroying it or just emitting depending on `autoDestroy`.
 *
 * `sync` is about *when* the error is emitted, and the answer is uncomfortable
 * on purpose. Emitting synchronously from inside a write is what node has
 * always done and what its tests depend on; deferring it is what a program
 * would expect. Node keeps both and lets the caller say, because changing the
 * default is a breaking change it has not made.
 */
export function errorOrDestroy(
  stream: ErrorOrDestroyStream,
  error?: unknown,
  sync = false,
): void {
  const r = stream._readableState;
  const w = stream._writableState;

  if (w?.destroyed || r?.destroyed) return;

  if ((r?.autoDestroy || w?.autoDestroy) && stream.destroy !== undefined) {
    stream.destroy(error);
  } else if (error) {
    if (error instanceof Error) void error.stack;

    if (w && !w.errored) w.errored = error;
    if (r && !r.errored) r.errored = error;

    if (sync) {
      nextTick(emitError, stream, error);
    } else {
      emitError(stream, error);
    }
  }
}

/**
 * Run a stream's `_construct`, holding everything else until it finishes.
 *
 * A stream with asynchronous setup -- a file that has to be opened -- is
 * usable immediately: writes queue and reads wait. This is what makes that
 * true, by clearing `constructed` until the callback arrives.
 */
export function construct(stream: DestroyableStream, callback: () => void): void {
  if (typeof stream._construct !== "function") return;

  const r = stream._readableState;
  const w = stream._writableState;

  if (r) r.constructed = false;
  if (w) w.constructed = false;

  stream.once(kConstruct, callback);

  // A duplex arrives here twice, once from each half, and must construct once.
  // The second caller has already added its listener above, so it can leave.
  if (stream.listenerCount(kConstruct) > 1) return;

  nextTick(runConstruct, stream);
}

function runConstruct(stream: DestroyableStream): void {
  let called = false;

  const onConstruct = (error?: unknown): void => {
    if (called) {
      errorOrDestroy(stream, error ?? new ERR_MULTIPLE_CALLBACK());
      return;
    }
    called = true;

    const r = stream._readableState;
    const w = stream._writableState;
    const state = w ?? r;

    if (r) r.constructed = true;
    if (w) w.constructed = true;

    if (state?.destroyed) {
      // Destroyed while constructing: the deferred teardown is waiting for
      // this, and gets the construction error along with its own.
      stream.emit(kDestroy, error);
    } else if (error) {
      errorOrDestroy(stream, error, true);
    } else {
      stream.emit(kConstruct);
    }
  };

  try {
    if (stream._construct === undefined) {
      onConstruct();
      return;
    }
    stream._construct((error) => {
      nextTick(onConstruct, error);
    });
  } catch (thrown) {
    nextTick(onConstruct, thrown);
  }
}

interface AbortableRequest {
  abort(): void;
}

/** An `http.ClientRequest`, which predates `destroy` and has `abort`. */
function isRequest(stream: unknown): stream is AbortableRequest {
  return stream !== null && typeof stream === "object" &&
    "setHeader" in stream && Boolean(stream.setHeader) &&
    "abort" in stream && typeof stream.abort === "function";
}

interface LegacyDestroyable {
  socket?: unknown;
  req?: unknown;
  destroy?(error?: unknown): void;
  close?(): void;
  abort?(): void;
  destroyed?: boolean;
  emit(event: string | symbol, ...args: unknown[]): boolean;
  [kIsDestroyed]?: unknown;
}

function isLegacyDestroyable(stream: unknown): stream is LegacyDestroyable {
  return stream !== null && typeof stream === "object" &&
    "emit" in stream && typeof stream.emit === "function";
}

function emitCloseLegacy(stream: { emit(event: string, ...args: unknown[]): boolean }): void {
  stream.emit("close");
}

function emitErrorCloseLegacy(
  stream: { emit(event: string, ...args: unknown[]): boolean },
  error: unknown,
): void {
  stream.emit("error", error);
  nextTick(emitCloseLegacy, stream);
}

/**
 * Destroy anything stream-shaped, however old.
 *
 * `pipeline` and `finished` accept whatever the caller has, which may predate
 * `destroy` entirely. The ladder tries the modern method, then the older
 * `abort`, then `close`, and finally fakes the events -- because a caller
 * waiting for `close` on an object that has no way to close would wait
 * forever.
 */
export function destroyer(stream: unknown, error?: unknown): void {
  if (!isLegacyDestroyable(stream) || isDestroyed(stream)) return;

  // Destroying a stream that had not finished is an abort, and saying so is
  // better than a `close` the caller cannot explain.
  if (!error && !isFinished(stream)) {
    error = new AbortError();
  }

  const s = stream;

  if (isServerRequest(s)) {
    s.socket = null;
    s.destroy?.(error);
  } else if (isRequest(s)) {
    s.abort();
  } else if (isRequest(s.req)) {
    s.req.abort();
  } else if (typeof s.destroy === "function") {
    s.destroy(error);
  } else if (typeof s.close === "function") {
    s.close();
  } else if (error) {
    nextTick(emitErrorCloseLegacy, s, error);
  } else {
    nextTick(emitCloseLegacy, s);
  }

  // Branded, so that a stream with no state of its own is still recognised as
  // destroyed by `isDestroyed` on the next pass.
  if (!s.destroyed) {
    s[kIsDestroyed] = true;
  }
}
