// When is a stream done, from node v24.20.0
// `lib/internal/streams/end-of-stream.js`.
//
// The question sounds simple and is the hardest one in this module. A stream
// can finish by ending, by erroring, by being destroyed, or by closing without
// saying which -- and a duplex can do two of those at once, on different
// sides. Worse, not every stream emits every event: `close` is optional, older
// streams never had it, and `http.ClientRequest` signals completion with
// `complete` and `abort` instead.
//
// So this listens for all of them, decides what the combination meant, and
// calls back exactly once. The alternative -- each caller listening for the
// two or three events it happens to know about -- is what `pipeline` and
// `finished` would otherwise each get subtly wrong.
//
// "Premature close" is the interesting verdict: a stream that closed while it
// still had a side that had not finished did not complete, and reporting
// success there would silently truncate whatever was being copied.

import {
  AbortError,
  ERR_INVALID_ARG_TYPE,
  ERR_STREAM_PREMATURE_CLOSE,
} from "../../internal/errors.ts";
import { nextTick } from "../../internal/tick.ts";
import {
  validateAbortSignal,
  validateBoolean,
  validateFunction,
  validateObject,
} from "../../internal/validators.ts";
import {
  isClosed,
  isNodeStream,
  isReadable,
  isReadableErrored,
  isReadableFinished,
  isReadableNodeStream,
  isReadableStream,
  isWritable,
  isWritableErrored,
  isWritableFinished,
  isWritableNodeStream,
  isWritableStream,
  kIsClosedPromise,
  willEmitClose as mayEmitClose,
} from "./utils.ts";
import type { StreamLike } from "./utils.ts";

const nop = (): void => {};

export interface EndOfStreamOptions {
  /** Watch the readable side. Defaults to whether there is one. */
  readable?: boolean | undefined;
  /** Watch the writable side. Defaults to whether there is one. */
  writable?: boolean | undefined;
  /** Listen for `error`. `false` leaves errors to somebody else. */
  error?: boolean | undefined;
  signal?: AbortSignalLike | undefined;
  /** Remove the listeners once the callback has run. */
  cleanup?: boolean | undefined;
}

/** As much of an `AbortSignal` as this file uses. See `process/src/promises`. */
export interface AbortSignalLike {
  readonly aborted: boolean;
  readonly reason: unknown;
  addEventListener(type: "abort", listener: () => void, options?: { once?: boolean }): void;
  removeEventListener(type: "abort", listener: () => void): void;
}

export type EndOfStreamCallback = (this: unknown, error?: unknown) => void;

/**
 * Call `settle` when the callback would settle synchronously, rather than on a
 * tick.
 *
 * Internal. `pipeline` needs to know *now* whether a stage is already
 * finished, because deferring that decision means starting a copy into a
 * stream that has already gone.
 */
export const kSynchronousCallback = Symbol("kEosNodeSynchronousCallback");

/** Wrap so that only the first call gets through. */
function once<A extends unknown[]>(fn: (this: unknown, ...args: A) => void) {
  let called = false;
  return function (this: unknown, ...args: A): void {
    if (called) return;
    called = true;
    fn.apply(this, args);
  };
}

/** Add an abort listener and give back something that removes it. */
function addAbortListener(signal: AbortSignalLike, listener: () => void): () => void {
  signal.addEventListener("abort", listener, { once: true });
  return () => signal.removeEventListener("abort", listener);
}

/** An `http.ClientRequest`, which finishes differently from everything else. */
function isRequest(stream: StreamLike): boolean {
  return Boolean(stream["setHeader"] && typeof stream["abort"] === "function");
}

/** The error the stream is already carrying, if any. */
function currentError(stream: unknown): unknown {
  const errored = isWritableErrored(stream) || isReadableErrored(stream);
  return (typeof errored !== "boolean" && errored) || null;
}

/**
 * What a `close` means, given how far each side had got.
 *
 * A side that was being watched and had not finished makes this a premature
 * close: the stream stopped without delivering what it said it would.
 */
function errorOnClose(
  stream: unknown,
  readable: boolean,
  readableFinished: boolean | null,
  writable: boolean,
  writableFinished: boolean | null,
): unknown {
  const errored = currentError(stream);
  if (errored) return errored;

  if (readable && !readableFinished && isReadableNodeStream(stream, true)) {
    if (!isReadableFinished(stream, false)) return new ERR_STREAM_PREMATURE_CLOSE();
  }
  if (writable && !writableFinished) {
    if (!isWritableFinished(stream, false)) return new ERR_STREAM_PREMATURE_CLOSE();
  }

  return null;
}

/**
 * Call `callback` when `stream` is finished, however it finishes.
 *
 * Returns a function that removes every listener this added. Callers that keep
 * a stream around after watching it must use it, or each `eos` leaves a dozen
 * listeners behind.
 */
export function eos(
  stream: unknown,
  options: EndOfStreamOptions | EndOfStreamCallback | null | undefined,
  callback?: EndOfStreamCallback,
): () => void {
  let opts: EndOfStreamOptions;
  if (typeof options === "function") {
    callback = options;
    opts = {};
  } else if (options == null) {
    opts = {};
  } else {
    validateObject(options, "options");
    opts = options;
  }
  validateFunction(callback, "callback");
  validateAbortSignal(opts.signal, "options.signal");
  let done = callback as EndOfStreamCallback;

  if (isReadableStream(stream) || isWritableStream(stream)) {
    return eosWeb(stream as StreamLike, opts, done);
  }

  if (!isNodeStream(stream)) {
    throw new ERR_INVALID_ARG_TYPE(
      "stream",
      ["ReadableStream", "WritableStream", "Stream"],
      stream,
    );
  }

  const s = stream as StreamLike & {
    on(event: string, listener: (...args: never[]) => void): unknown;
    removeListener(event: string, listener: (...args: never[]) => void): unknown;
  };

  const readable = opts.readable ?? isReadableNodeStream(s);
  const writable = opts.writable ?? isWritableNodeStream(s);

  // Whether waiting for `close` will be answered. Only trusted when the
  // stream's own sides match what we were asked to watch -- a caller watching
  // one half of a duplex cannot rely on a `close` that covers both.
  let willEmitClose =
    Boolean(mayEmitClose(s)) &&
    isReadableNodeStream(s) === readable &&
    isWritableNodeStream(s) === writable;

  let writableFinished = isWritableFinished(s, false);
  let readableFinished = isReadableFinished(s, false);

  const wState = s._writableState;
  const rState = s._readableState;

  // `undefined` means "not yet known"; `null` means "finished, no error".
  let immediate: unknown = undefined;

  if (isClosed(s)) {
    immediate = errorOnClose(s, readable, readableFinished, writable, writableFinished);
  } else if (wState?.errorEmitted || rState?.errorEmitted) {
    if (!willEmitClose) immediate = currentError(s);
  } else if (
    !readable &&
    (!willEmitClose || isReadable(s)) &&
    (writableFinished || isWritable(s) === false) &&
    (wState == null || wState["pendingcb"] === undefined || wState["pendingcb"] === 0)
  ) {
    immediate = currentError(s);
  } else if (
    !writable &&
    (!willEmitClose || isWritable(s)) &&
    (readableFinished || isReadable(s) === false)
  ) {
    immediate = currentError(s);
  } else if (rState && s["req"] && s["aborted"]) {
    immediate = currentError(s);
  }

  let cleanup = (): void => {
    done = nop;
  };

  if (immediate !== undefined) {
    if (opts.error !== false) {
      // A no-op error listener, so that reporting the error through the
      // callback does not *also* throw it as an unhandled `error` event.
      s.on("error", nop);
      cleanup = () => {
        done = nop;
        s.removeListener("error", nop);
      };
    }
  } else if (opts.signal?.aborted) {
    immediate = new AbortError(undefined, { cause: opts.signal.reason });
  }

  if (immediate !== undefined && (opts as Record<symbol, unknown>)[kSynchronousCallback]) {
    Reflect.apply(done, s, immediate === null ? [] : [immediate]);
    return cleanup;
  }

  if (immediate !== undefined) {
    // On a tick even though the answer is known, so that `eos` never calls
    // back before it has returned its cleanup function.
    const settled = immediate;
    nextTick(() => Reflect.apply(done, s, settled === null ? [] : [settled]));
    return cleanup;
  }

  done = once(done);

  // A stream with no writable state cannot emit `finish`; for those, losing
  // `writable` is the end of writing.
  const onLegacyFinish = (): void => {
    if (!s["writable"]) onFinish();
  };

  const onFinish = (): void => {
    writableFinished = true;
    // Destroyed here means somebody stepped outside the normal path, and
    // `close` can no longer be relied on to arrive.
    if (s["destroyed"]) willEmitClose = false;
    if (willEmitClose && (!s["readable"] || readable)) return;
    if (!readable || readableFinished) done.call(s);
  };

  const onEnd = (): void => {
    readableFinished = true;
    if (s["destroyed"]) willEmitClose = false;
    if (willEmitClose && (!s["writable"] || writable)) return;
    if (!writable || writableFinished) done.call(s);
  };

  const onError = (error: unknown): void => {
    done.call(s, error);
  };

  const onClose = (): void => {
    const error = errorOnClose(s, readable, readableFinished, writable, writableFinished);
    if (error === null) done.call(s);
    else done.call(s, error);
  };

  const onRequest = (): void => {
    (s["req"] as StreamLike & { on(e: string, l: () => void): void }).on("finish", onFinish);
  };

  if (isRequest(s)) {
    s.on("complete", onFinish);
    if (!willEmitClose) s.on("abort", onClose);
    if (s["req"]) onRequest();
    else s.on("request", onRequest);
  } else if (writable && !wState) {
    // A stream from before `finish` existed.
    s.on("end", onLegacyFinish);
    s.on("close", onLegacyFinish);
  }

  // Not everything that aborts goes on to close.
  if (!willEmitClose && typeof s["aborted"] === "boolean") {
    s.on("aborted", onClose);
  }

  s.on("end", onEnd);
  s.on("finish", onFinish);
  if (opts.error !== false) s.on("error", onError);
  s.on("close", onClose);

  cleanup = () => {
    done = nop;
    s.removeListener("aborted", onClose);
    s.removeListener("complete", onFinish);
    s.removeListener("abort", onClose);
    s.removeListener("request", onRequest);
    if (s["req"]) {
      (s["req"] as StreamLike & { removeListener(e: string, l: () => void): void })
        .removeListener("finish", onFinish);
    }
    s.removeListener("end", onLegacyFinish);
    s.removeListener("close", onLegacyFinish);
    s.removeListener("finish", onFinish);
    s.removeListener("end", onEnd);
    s.removeListener("error", onError);
    s.removeListener("close", onClose);
  };

  if (opts.signal) {
    const signal = opts.signal;
    const abort = (): void => {
      // Held before `cleanup`, which replaces `done` with a no-op.
      const settle = done;
      cleanup();
      settle.call(s, new AbortError(undefined, { cause: signal.reason }));
    };
    const remove = addAbortListener(signal, abort);
    const inner = done;
    done = once(function (this: unknown, error?: unknown) {
      remove();
      Reflect.apply(inner, this, error === undefined ? [] : [error]);
    });
  }

  return cleanup;
}

/**
 * The same question for a web stream, which answers it with one promise.
 *
 * Nothing to listen for and nothing to clean up: a web stream carries a
 * `closed` promise that settles either way, so the whole of the work is
 * attaching to it.
 */
function eosWeb(
  stream: StreamLike,
  options: EndOfStreamOptions,
  callback: EndOfStreamCallback,
): () => void {
  let settle = once(callback);
  let aborted = false;

  if (options.signal) {
    const signal = options.signal;
    const abort = (): void => {
      aborted = true;
      settle.call(stream, new AbortError(undefined, { cause: signal.reason }));
    };
    if (signal.aborted) {
      nextTick(abort);
    } else {
      const remove = addAbortListener(signal, abort);
      const inner = settle;
      settle = once(function (this: unknown, error?: unknown) {
        remove();
        Reflect.apply(inner, this, error === undefined ? [] : [error]);
      });
    }
  }

  const resolved = (...args: unknown[]): void => {
    if (!aborted) nextTick(() => Reflect.apply(settle, stream, args));
  };

  const closed = stream[kIsClosedPromise] as { promise: Promise<unknown> };
  closed.promise.then(resolved, resolved);

  return nop;
}

/**
 * `eos` as a promise.
 *
 * `cleanup` removes the listeners once it settles. Off by default because a
 * caller that awaits this and then keeps using the stream may want the
 * listeners to stay; on, it is the right choice for anything that watches many
 * streams in a loop.
 */
export function finished(stream: unknown, opts?: EndOfStreamOptions | null): Promise<void> {
  let autoCleanup = false;
  const options: EndOfStreamOptions = opts ?? {};
  if (options.cleanup) {
    validateBoolean(options.cleanup, "cleanup");
    autoCleanup = options.cleanup;
  }
  return new Promise<void>((resolve, reject) => {
    const cleanup = eos(stream, options, (error) => {
      if (autoCleanup) cleanup();
      if (error) reject(error);
      else resolve();
    });
  });
}
