// Connecting streams so that failure propagates, from node v24.20.0
// `lib/internal/streams/pipeline.js`.
//
// `a.pipe(b).pipe(c)` reads well and leaks. If `b` fails, `a` is never told
// and keeps reading; if `c` fails, neither of the others is told. Every stage
// has to be destroyed when any stage fails, and a program written with `pipe`
// has to do that by hand at every joint. `pipeline` is that bookkeeping, done
// once.
//
// It also accepts things that are not streams. A generator function, an async
// iterable, a promise, a web stream: each is adapted to whatever the next
// stage needs, so a transformation that is naturally a generator does not have
// to be dressed up as a `Transform` first.
//
// The counting is the part to read carefully. `finishCount` is how many stages
// are still expected to report, and the callback runs when it reaches zero --
// or immediately on the first error, because after an error the remaining
// stages are being torn down rather than finishing.

import {
  aggregateTwoErrors,
  AbortError,
  ERR_INVALID_ARG_TYPE,
  ERR_INVALID_RETURN_VALUE,
  ERR_MISSING_ARGS,
  ERR_STREAM_DESTROYED,
  ERR_STREAM_PREMATURE_CLOSE,
  ERR_STREAM_UNABLE_TO_PIPE,
} from "../../internal/errors.ts";
import { nextTick } from "../../internal/tick.ts";
import { validateAbortSignal, validateFunction } from "../../internal/validators.ts";
import {
  isIterable,
  isNodeStream,
  isReadable,
  isReadableFinished,
  isReadableNodeStream,
  isReadableStream,
  isTransformStream,
  isWebStream,
} from "./utils.ts";
import { destroyer as destroyStream } from "./destroy.ts";
import { eos } from "./end-of-stream.ts";
import type { AbortSignalLike } from "./end-of-stream.ts";
import { Duplex } from "./duplex.ts";
import { PassThrough } from "./passthrough.ts";
import { Readable } from "./readable.ts";

type AnyStream = Record<string | symbol, unknown>;

/**
 * As much of an `AbortController` as the pipeline uses.
 *
 * Declared rather than taken from a DOM library for the same reason as
 * `AbortSignalLike`: the only thing done with it is `abort()` and handing its
 * signal to the stages, and naming a concrete class would be a stricter claim
 * than the code makes.
 */
declare const AbortController: {
  new (): { readonly signal: AbortSignalLike; abort(reason?: unknown): void };
};
export type PipelineCallback = (error?: unknown, value?: unknown) => void;

export interface PipelineOptions {
  signal?: AbortSignalLike | undefined;
  /** Whether the last stage is ended when the one before it finishes. */
  end?: boolean | undefined;
}

function once(fn: PipelineCallback): PipelineCallback {
  let called = false;
  return (error?: unknown, value?: unknown) => {
    if (called) return;
    called = true;
    fn(error, value);
  };
}

/**
 * Arrange for one stage to be destroyed if the pipeline fails.
 *
 * The `close` listener is what makes `destroy` idempotent from the outside: a
 * stage that closed on its own must not then be destroyed with an error when
 * a later stage fails.
 */
function stageDestroyer(stream: AnyStream, reading: boolean, writing: boolean) {
  let finished = false;
  (stream["on"] as (e: string, l: () => void) => void)("close", () => {
    finished = true;
  });

  const cleanup = eos(stream, { readable: reading, writable: writing }, (error) => {
    finished = !error;
  });

  return {
    destroy: (error?: unknown) => {
      if (finished) return;
      finished = true;
      destroyStream(stream, error || new ERR_STREAM_DESTROYED("pipe"));
    },
    cleanup,
  };
}

function popCallback(streams: unknown[]): PipelineCallback {
  // The array always has at least one entry, so the average case is optimised
  // for rather than checking for empty as well.
  validateFunction(streams[streams.length - 1], "streams[stream.length - 1]");
  return streams.pop() as PipelineCallback;
}

function makeAsyncIterable(value: unknown): AsyncIterable<unknown> | Iterable<unknown> {
  if (isIterable(value)) return value as AsyncIterable<unknown>;
  // A stream from before streams were iterable.
  if (isReadableNodeStream(value)) return fromReadable(value as Readable);
  throw new ERR_INVALID_ARG_TYPE("val", ["Readable", "Iterable", "AsyncIterable"], value);
}

async function* fromReadable(value: Readable): AsyncGenerator<unknown, void, void> {
  yield* Readable.prototype[Symbol.asyncIterator].call(value);
}

/**
 * Copy an iterable into a node writable, respecting backpressure.
 *
 * The `wait` dance exists because `write` returning false and the `drain` that
 * follows are events, and this is a loop. `resume` is both the drain listener
 * and the end-of-stream callback, so a destination that fails wakes the loop
 * just as a destination that drained does -- otherwise the loop would wait
 * forever on a stream that is never going to drain.
 */
async function pumpToNode(
  iterable: AsyncIterable<unknown> | Iterable<unknown>,
  writable: AnyStream,
  finish: (error?: unknown) => void,
  { end }: { end: boolean },
): Promise<void> {
  let error: unknown;
  let onResolve: (() => void) | null = null;

  const resume = (err?: unknown): void => {
    if (err) error = err;
    if (onResolve) {
      const callback = onResolve;
      onResolve = null;
      callback();
    }
  };

  const wait = (): Promise<void> =>
    new Promise<void>((resolve, reject) => {
      if (error) {
        reject(error);
      } else {
        onResolve = () => {
          if (error) reject(error);
          else resolve();
        };
      }
    });

  (writable["on"] as (e: string, l: (err?: unknown) => void) => void)("drain", resume);
  const cleanup = eos(writable, { readable: false }, resume);

  try {
    if (writable["writableNeedDrain"]) await wait();

    for await (const chunk of iterable) {
      if (!(writable["write"] as (c: unknown) => boolean)(chunk)) await wait();
    }

    if (end) {
      (writable["end"] as () => void)();
      await wait();
    }

    finish();
  } catch (thrown) {
    finish(error !== thrown ? aggregateTwoErrors(error, thrown) : thrown);
  } finally {
    cleanup();
    (writable["off"] as (e: string, l: (err?: unknown) => void) => void)("drain", resume);
  }
}

/** The same, into a web writable, whose backpressure is `writer.ready`. */
async function pumpToWeb(
  readable: AsyncIterable<unknown> | Iterable<unknown>,
  writable: AnyStream,
  finish: (error?: unknown) => void,
  { end }: { end: boolean },
): Promise<void> {
  let target = writable;
  if (isTransformStream(target)) target = target["writable"] as AnyStream;

  const writer = (target["getWriter"] as () => {
    ready: Promise<void>;
    write(chunk: unknown): Promise<void>;
    close(): Promise<void>;
    abort(error: unknown): Promise<void>;
  })();

  try {
    for await (const chunk of readable) {
      await writer.ready;
      // Deliberately not awaited: the spec's manual-write pattern waits on
      // `ready` for backpressure and lets the write settle on its own, so
      // that a rejection surfaces through `ready` rather than here.
      writer.write(chunk).catch(() => {});
    }
    await writer.ready;
    if (end) await writer.close();
    finish();
  } catch (thrown) {
    try {
      await writer.abort(thrown);
      finish(thrown);
    } catch (abortError) {
      finish(abortError);
    }
  }
}

export function pipeline(...streams: unknown[]): unknown {
  return pipelineImpl(streams, once(popCallback(streams)));
}

export function pipelineImpl(
  streams: unknown[],
  callback: PipelineCallback,
  opts?: PipelineOptions,
): unknown {
  if (streams.length === 1 && Array.isArray(streams[0])) {
    streams = streams[0] as unknown[];
  }

  if (streams.length < 2) throw new ERR_MISSING_ARGS("streams");

  const controller = new AbortController();
  const signal = controller.signal as unknown as AbortSignalLike;
  const outerSignal = opts?.signal;

  // Listeners on the *last* stage are removed only when the pipeline succeeds:
  // a caller that keeps reading the result needs them gone, and a caller
  // handling a failure needs them still there.
  const lastStreamCleanup: (() => void)[] = [];

  validateAbortSignal(outerSignal, "options.signal");

  function abort(): void {
    finishImpl(new AbortError(undefined, { cause: outerSignal?.reason }), false);
  }

  let removeAbortListener: (() => void) | undefined;
  if (outerSignal) {
    outerSignal.addEventListener("abort", abort, { once: true });
    removeAbortListener = () => outerSignal.removeEventListener("abort", abort);
  }

  let error: unknown;
  let value: unknown;
  const destroys: ((error?: unknown) => void)[] = [];
  let finishCount = 0;

  function finish(err?: unknown): void {
    finishImpl(err, --finishCount === 0);
  }

  function finishOnlyHandleError(err?: unknown): void {
    finishImpl(err, false);
  }

  function finishImpl(err: unknown, final: boolean): void {
    // A premature close or an abort is a *symptom*: if a real error arrives
    // later it explains the close, so it replaces it.
    if (
      err &&
      (!error ||
        (error as { code?: string }).code === "ERR_STREAM_PREMATURE_CLOSE" ||
        (error as { name?: string }).name === "AbortError")
    ) {
      error = err;
    }

    if (!error && !final) return;

    while (destroys.length) {
      (destroys.shift() as (error?: unknown) => void)(error);
    }

    removeAbortListener?.();
    controller.abort();

    if (final) {
      if (!error) lastStreamCleanup.forEach((fn) => fn());
      nextTick(callback, error, value);
    }
  }

  let ret: unknown;
  for (let i = 0; i < streams.length; i++) {
    const stream = streams[i] as AnyStream;
    const reading = i < streams.length - 1;
    const writing = i > 0;
    const next = i + 1 < streams.length ? (streams[i + 1] as AnyStream) : null;
    const end = reading || opts?.end !== false;
    const isLastStream = i === streams.length - 1;

    if (isNodeStream(stream)) {
      // Refused up front: writing into a stage that is already gone would
      // fail one chunk at a time instead of saying what is wrong.
      if (next !== null && (next["closed"] || next["destroyed"])) {
        throw new ERR_STREAM_UNABLE_TO_PIPE();
      }

      if (end) {
        const { destroy, cleanup } = stageDestroyer(stream, reading, writing);
        destroys.push(destroy);
        if (isReadable(stream) && isLastStream) lastStreamCleanup.push(cleanup);
      }

      // An error after the copy has finished still has to reach the caller.
      const onError = (err: unknown): void => {
        if (
          err &&
          (err as { name?: string }).name !== "AbortError" &&
          (err as { code?: string }).code !== "ERR_STREAM_PREMATURE_CLOSE"
        ) {
          finishOnlyHandleError(err);
        }
      };
      (stream["on"] as (e: string, l: (err: unknown) => void) => void)("error", onError);
      if (isReadable(stream) && isLastStream) {
        lastStreamCleanup.push(() => {
          (stream["removeListener"] as (e: string, l: (err: unknown) => void) => void)(
            "error",
            onError,
          );
        });
      }
    }

    if (i === 0) {
      if (typeof stream === "function") {
        ret = (stream as unknown as (o: { signal: AbortSignalLike }) => unknown)({ signal });
        if (!isIterable(ret)) {
          throw new ERR_INVALID_RETURN_VALUE("Iterable, AsyncIterable or Stream", "source", ret);
        }
      } else if (isIterable(stream) || isReadableNodeStream(stream) || isTransformStream(stream)) {
        ret = stream;
      } else {
        ret = Duplex.from(stream);
      }
    } else if (typeof stream === "function") {
      ret = isTransformStream(ret)
        ? makeAsyncIterable((ret as AnyStream)["readable"])
        : makeAsyncIterable(ret);
      ret = (stream as unknown as (
        source: unknown,
        o: { signal: AbortSignalLike },
      ) => unknown)(ret, { signal });

      if (reading) {
        if (!isIterable(ret, true)) {
          throw new ERR_INVALID_RETURN_VALUE("AsyncIterable", `transform[${i - 1}]`, ret);
        }
      } else {
        // The last stage is a function, so the pipeline has nothing
        // stream-shaped to return. A `PassThrough` stands in, so that
        // `pipeline(...)` is always something you can go on to pipe.
        const pt = new PassThrough({ objectMode: true });

        // Read once: `then` may be a getter that throws the second time, and
        // Promises/A+ allows that.
        const then = (ret as { then?: unknown })?.then;
        if (typeof then === "function") {
          finishCount++;
          (then as (onOk: (v: unknown) => void, onErr: (e: unknown) => void) => void).call(
            ret,
            (resolved: unknown) => {
              value = resolved;
              if (resolved != null) pt.write(resolved);
              if (end) pt.end();
              nextTick(finish);
            },
            (err: unknown) => {
              pt.destroy(err);
              nextTick(finish, err);
            },
          );
        } else if (isIterable(ret, true)) {
          finishCount++;
          void pumpToNode(ret as AsyncIterable<unknown>, pt as unknown as AnyStream, finish, { end });
        } else if (isReadableStream(ret) || isTransformStream(ret)) {
          const toRead = ((ret as AnyStream)["readable"] ?? ret) as AsyncIterable<unknown>;
          finishCount++;
          void pumpToNode(toRead, pt as unknown as AnyStream, finish, { end });
        } else {
          throw new ERR_INVALID_RETURN_VALUE("AsyncIterable or Promise", "destination", ret);
        }

        ret = pt;

        const { destroy, cleanup } = stageDestroyer(pt as unknown as AnyStream, false, true);
        destroys.push(destroy);
        if (isLastStream) lastStreamCleanup.push(cleanup);
      }
    } else if (isNodeStream(stream)) {
      if (isReadableNodeStream(ret)) {
        // Two: one for each end of the copy.
        finishCount += 2;
        const cleanup = pipeStage(ret as AnyStream, stream, finish, finishOnlyHandleError, { end });
        if (isReadable(stream) && isLastStream) lastStreamCleanup.push(cleanup);
      } else if (isTransformStream(ret) || isReadableStream(ret)) {
        const toRead = ((ret as AnyStream)["readable"] ?? ret) as AsyncIterable<unknown>;
        finishCount++;
        void pumpToNode(toRead, stream, finish, { end });
      } else if (isIterable(ret)) {
        finishCount++;
        void pumpToNode(ret as AsyncIterable<unknown>, stream, finish, { end });
      } else {
        throw new ERR_INVALID_ARG_TYPE(
          "val",
          ["Readable", "Iterable", "AsyncIterable", "ReadableStream", "TransformStream"],
          ret,
        );
      }
      ret = stream;
    } else if (isWebStream(stream)) {
      if (isReadableNodeStream(ret)) {
        finishCount++;
        void pumpToWeb(makeAsyncIterable(ret), stream, finish, { end });
      } else if (isReadableStream(ret) || isIterable(ret)) {
        finishCount++;
        void pumpToWeb(ret as AsyncIterable<unknown>, stream, finish, { end });
      } else if (isTransformStream(ret)) {
        finishCount++;
        void pumpToWeb((ret as AnyStream)["readable"] as AsyncIterable<unknown>, stream, finish, {
          end,
        });
      } else {
        throw new ERR_INVALID_ARG_TYPE(
          "val",
          ["Readable", "Iterable", "AsyncIterable", "ReadableStream", "TransformStream"],
          ret,
        );
      }
      ret = stream;
    } else {
      ret = Duplex.from(stream);
    }
  }

  if (signal?.aborted || outerSignal?.aborted) {
    nextTick(abort);
  }

  return ret;
}

/**
 * Copy one node stream into the next.
 *
 * Not `src.pipe(dst)` alone: the ending is taken over here so that the
 * pipeline decides when the destination closes, and both ends are watched so
 * that a failure at either is reported once.
 */
function pipeStage(
  src: AnyStream,
  dst: AnyStream,
  finish: (error?: unknown) => void,
  finishOnlyHandleError: (error?: unknown) => void,
  { end }: { end: boolean },
): () => void {
  let ended = false;

  (dst["on"] as (e: string, l: () => void) => void)("close", () => {
    // The destination closed before the source was done with it.
    if (!ended) finishOnlyHandleError(new ERR_STREAM_PREMATURE_CLOSE());
  });

  // `end: false` because the ending is arranged below instead, where it can
  // be skipped for a destination the caller asked to keep open.
  (src["pipe"] as (d: AnyStream, o: { end: boolean }) => void)(dst, { end: false });

  if (end) {
    const endDestination = (): void => {
      ended = true;
      (dst["end"] as () => void)();
    };

    if (isReadableFinished(src)) nextTick(endDestination);
    else (src["once"] as (e: string, l: () => void) => void)("end", endDestination);
  } else {
    finish();
  }

  eos(src, { readable: true, writable: false }, (err) => {
    const rState = (src as { _readableState?: { ended?: boolean; errored?: unknown; errorEmitted?: boolean } })
      ._readableState;
    if (
      err &&
      (err as { code?: string }).code === "ERR_STREAM_PREMATURE_CLOSE" &&
      rState?.ended &&
      !rState.errored &&
      !rState.errorEmitted
    ) {
      // Some readables emit `close` before `end`. Since this side has ended
      // with no error, the `end` is still coming and is what matters; waiting
      // for it is the backwards-compatible reading and makes no observable
      // difference to a piped destination.
      (src["once"] as (e: string, l: (e?: unknown) => void) => AnyStream)("end", finish);
      (src["once"] as (e: string, l: (e?: unknown) => void) => AnyStream)("error", finish);
    } else {
      finish(err);
    }
  });

  return eos(dst, { readable: false, writable: true }, finish);
}
