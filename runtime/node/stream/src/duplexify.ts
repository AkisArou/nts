// `Duplex.from`, from node v24.20.0 `lib/internal/streams/duplexify.js`.
//
// Turns almost anything into a duplex: a readable, a writable, a `{ readable,
// writable }` pair, an iterable, a promise, or an async generator function.
// `pipeline` and `compose` use it so that a stage can be written as whatever
// it naturally is rather than dressed up as a stream first.
//
// The async-generator case is the interesting one. A generator function is
// given a source it can `for await` over, and produces values; but a duplex
// is written *to*, one chunk at a time, with a callback per chunk. `fromAsyncGen`
// bridges those by handing the generator a source that is itself driven by the
// duplex's `_write` -- each write resolves the promise the generator is
// awaiting, and the generator's next `yield` becomes a chunk on the readable
// side.
//
// **The web-stream branches are absent.** Node accepts a `ReadableStream` or a
// `WritableStream` here and adapts it; that needs the WHATWG streams, which
// this profile does not have. Rather than a branch that fails obscurely, those
// values fall through to the final `ERR_INVALID_ARG_TYPE`, whose list of
// accepted types says what is actually accepted.

import {
  AbortError,
  ERR_INVALID_ARG_TYPE,
  ERR_INVALID_RETURN_VALUE,
} from "../../internal/errors.ts";
import { nextTick } from "../../internal/tick.ts";
import { Duplex, setDuplexify } from "./duplex.ts";
import type { DuplexOptions } from "./duplex.ts";
import { Readable } from "./readable.ts";
import { from } from "./from.ts";
import { destroyer } from "./destroy.ts";
import { eos } from "./end-of-stream.ts";
import {
  isDuplexNodeStream,
  isIterable,
  isNodeStream,
  isReadable,
  isReadableNodeStream,
  isWritable,
  isWritableNodeStream,
} from "./utils.ts";
import type { AbortSignalLike } from "./end-of-stream.ts";

declare const AbortController: {
  new (): { readonly signal: AbortSignalLike; abort(reason?: unknown): void };
};

type WriteCb = (error?: unknown) => void;

/**
 * A `Duplex` whose sides can be switched off at construction.
 *
 * The plain `Duplex` already does this; the subclass exists so that
 * `Duplex.from` produces something distinguishable, and so the disabling
 * happens after `Duplex`'s own constructor rather than being threaded through
 * it.
 */
class Duplexify extends Duplex {
  constructor(options?: DuplexOptions) {
    super(options);

    if (options?.readable === false) {
      this._readableState.readable = false;
      this._readableState.ended = true;
      this._readableState.endEmitted = true;
    }

    if (options?.writable === false) {
      this._writableState.writable = false;
      this._writableState.ending = true;
      this._writableState.ended = true;
      this._writableState.finished = true;
    }
  }
}

type AnyRecord = Record<string, unknown>;

export function duplexify(body: unknown, name: string): Duplex {
  if (isDuplexNodeStream(body)) return body as Duplex;

  if (isReadableNodeStream(body)) return joinPair({ readable: body as Readable });
  if (isWritableNodeStream(body)) return joinPair({ writable: body as AnyRecord });

  // A node stream that is neither readable nor writable: a duplex with both
  // sides already closed, which is what it is.
  if (isNodeStream(body)) return joinPair({ writable: false, readable: false });

  if (typeof body === "function") {
    const { value, write, final, destroy } = fromAsyncGen(
      body as (source: AsyncGenerator<unknown>, opts: { signal: AbortSignalLike }) => unknown,
    );

    // It may have been a constructor rather than a generator function.
    if (isDuplexNodeStream(value)) return value as Duplex;

    if (isIterable(value)) {
      return from(value, { objectMode: true, write, final, destroy } as DuplexOptions, Duplexify);
    }

    const then = (value as { then?: unknown })?.then;
    if (typeof then === "function") {
      let d: Duplexify;

      const promise = (then as (ok: (v: unknown) => void, no: (e: unknown) => void) => unknown)
        .call(
          value,
          (resolved: unknown) => {
            // An async function used as a duplex body writes through the
            // source it was given; returning a value as well is ambiguous
            // about which was meant.
            if (resolved != null) {
              throw new ERR_INVALID_RETURN_VALUE("nully", "body", resolved);
            }
          },
          (error: unknown) => {
            destroyer(d, error);
          },
        ) as Promise<void>;

      d = new Duplexify({
        objectMode: true,
        readable: false,
        write,
        final(callback: WriteCb) {
          final(async () => {
            try {
              await promise;
              nextTick(callback, null);
            } catch (error) {
              nextTick(callback, error);
            }
          });
        },
        destroy,
      } as DuplexOptions);
      return d;
    }

    throw new ERR_INVALID_RETURN_VALUE("Iterable, AsyncIterable or AsyncFunction", name, value);
  }

  // A `Blob` is bytes with a promise in front of them.
  const BlobCtor = (globalThis as { Blob?: new () => unknown }).Blob;
  if (BlobCtor && body instanceof BlobCtor) {
    return duplexify((body as { arrayBuffer(): Promise<ArrayBuffer> }).arrayBuffer(), name);
  }

  if (isIterable(body)) {
    return from(body, { objectMode: true, writable: false } as DuplexOptions, Duplexify);
  }

  const pair = body as { readable?: unknown; writable?: unknown } | null | undefined;
  if (typeof pair?.writable === "object" || typeof pair?.readable === "object") {
    const readable = pair.readable
      ? (isReadableNodeStream(pair.readable) ? pair.readable : duplexify(pair.readable, name))
      : undefined;
    const writable = pair.writable
      ? (isWritableNodeStream(pair.writable) ? pair.writable : duplexify(pair.writable, name))
      : undefined;
    return joinPair({ readable, writable } as { readable?: unknown; writable?: unknown });
  }

  const then = (body as { then?: unknown })?.then;
  if (typeof then === "function") {
    let d: Duplexify;
    (then as (ok: (v: unknown) => void, no: (e: unknown) => void) => void).call(
      body,
      (resolved: unknown) => {
        if (resolved != null) d.push(resolved);
        d.push(null);
      },
      (error: unknown) => {
        destroyer(d, error);
      },
    );
    d = new Duplexify({ objectMode: true, writable: false, read() {} } as DuplexOptions);
    return d;
  }

  throw new ERR_INVALID_ARG_TYPE(
    name,
    [
      "Blob",
      "Stream",
      "Iterable",
      "AsyncIterable",
      "Function",
      "{ readable, writable } pair",
      "Promise",
    ],
    body,
  );
}

/**
 * Drive an async generator from a duplex's writable side.
 *
 * The generator is handed a source it can `for await` over. Each `_write`
 * resolves the promise that source is waiting on, so a write becomes a value
 * the generator receives; `final` resolves it with `done`, ending the loop.
 * The callback travels with the chunk so the writable side is told when the
 * generator has actually taken it, which is what makes backpressure work
 * across the boundary.
 */
function fromAsyncGen(
  fn: (source: AsyncGenerator<unknown>, opts: { signal: AbortSignalLike }) => unknown,
): {
  value: unknown;
  write: (chunk: unknown, encoding: string, callback: WriteCb) => void;
  final: (callback: WriteCb) => void;
  destroy: (error: unknown, callback: WriteCb) => void;
} {
  type Handoff = { chunk?: unknown; done: boolean; cb: WriteCb };
  let resolvers = Promise.withResolvers<Handoff>();
  let promise: Promise<Handoff> | null = resolvers.promise;
  let resolve: ((value: Handoff) => void) | null = resolvers.resolve;

  const controller = new AbortController();
  const signal = controller.signal;

  const value = fn(
    (async function* source(): AsyncGenerator<unknown> {
      for (;;) {
        const waiting = promise as Promise<Handoff>;
        promise = null;
        const { chunk, done, cb } = await waiting;
        // On a tick, so the writable side's callback does not run inside the
        // generator's own frame.
        nextTick(cb);
        if (done) return;
        if (signal.aborted) {
          throw new AbortError(undefined, { cause: signal.reason });
        }
        resolvers = Promise.withResolvers<Handoff>();
        promise = resolvers.promise;
        resolve = resolvers.resolve;
        yield chunk;
      }
    })(),
    { signal },
  );

  return {
    value,
    write(chunk: unknown, _encoding: string, callback: WriteCb): void {
      const settle = resolve as (value: Handoff) => void;
      resolve = null;
      settle({ chunk, done: false, cb: callback });
    },
    final(callback: WriteCb): void {
      const settle = resolve as (value: Handoff) => void;
      resolve = null;
      settle({ done: true, cb: callback });
    },
    destroy(error: unknown, callback: WriteCb): void {
      controller.abort(error);
      // The generator may be parked waiting for the next write. Releasing it
      // is what lets it observe the abort and finish tearing down; without
      // this, destroying a duplex mid-write hangs.
      if (resolve !== null) {
        const settle = resolve as (value: Handoff) => void;
        resolve = null;
        settle({ done: true, cb: () => {} });
      }
      callback(error);
    },
  };
}

/**
 * A duplex over a separate readable and writable.
 *
 * The two halves are independent streams that know nothing about each other,
 * so this copies between them: `_write` forwards to the writable and waits for
 * its `drain`, `_read` pulls from the readable until it says stop. Node's note
 * that this double-buffers is accurate and is the price of the two halves
 * being ordinary streams.
 */
function joinPair(pair: { readable?: unknown; writable?: unknown }): Duplex {
  const r = pair.readable && typeof (pair.readable as AnyRecord)["read"] !== "function"
    ? from(pair.readable, { objectMode: true })
    : (pair.readable as AnyRecord | undefined);
  const w = pair.writable as AnyRecord | undefined;

  let readable = Boolean(isReadable(r));
  let writable = Boolean(isWritable(w));

  let onDrain: WriteCb | null = null;
  let onFinish: WriteCb | null = null;
  let onReadable: (() => void) | null = null;
  let onClose: WriteCb | null = null;

  const finished = (error?: unknown): void => {
    const callback = onClose;
    onClose = null;
    if (callback) callback(error);
    else if (error) d.destroy(error);
  };

  const d: Duplexify = new Duplexify({
    readableObjectMode: Boolean((r as AnyRecord | undefined)?.["readableObjectMode"]),
    writableObjectMode: Boolean(w?.["writableObjectMode"]),
    readable,
    writable,
  } as DuplexOptions);

  if (writable) {
    const writableSide = w as AnyRecord & {
      write(c: unknown, e: string): boolean;
      end(): void;
      on(e: string, l: () => void): void;
    };

    eos(writableSide, (error) => {
      writable = false;
      // The other half has nowhere to send its data now.
      if (error) destroyer(r, error);
      finished(error);
    });

    d._write = function (chunk: unknown, encoding: string, callback: WriteCb): void {
      if (writableSide.write(chunk, encoding)) callback();
      else onDrain = callback;
    };

    d._final = function (callback: WriteCb): void {
      writableSide.end();
      onFinish = callback;
    };

    writableSide.on("drain", () => {
      if (onDrain) {
        const callback = onDrain;
        onDrain = null;
        callback();
      }
    });

    writableSide.on("finish", () => {
      if (onFinish) {
        const callback = onFinish;
        onFinish = null;
        callback();
      }
    });
  }

  if (readable) {
    const readableSide = r as AnyRecord & {
      read(): unknown;
      on(e: string, l: () => void): void;
    };

    eos(readableSide, (error) => {
      readable = false;
      if (error) destroyer(w, error);
      finished(error);
    });

    readableSide.on("readable", () => {
      if (onReadable) {
        const callback = onReadable;
        onReadable = null;
        callback();
      }
    });

    readableSide.on("end", () => {
      d.push(null);
    });

    d._read = function (): void {
      for (;;) {
        const chunk = readableSide.read();
        // Nothing available: wait for `readable` and resume from here.
        if (chunk === null) {
          // Resumed from here when the source has more. Wrapped rather than
          // bound, because `_read` takes the advisory size and this call site
          // has none to offer -- the size that matters is the wrapped
          // stream's own.
          onReadable = () => d._read(0);
          return;
        }
        if (!d.push(chunk)) return;
      }
    };
  }

  d._destroy = function (error: unknown, callback: WriteCb): void {
    // Being destroyed without a reason, while a teardown is already in
    // flight, is an abort as far as the two halves are concerned.
    if (!error && onClose !== null) error = new AbortError();

    onReadable = null;
    onDrain = null;
    onFinish = null;

    if (onClose === null) {
      callback(error);
    } else {
      onClose = callback;
      destroyer(w, error);
      destroyer(r, error);
    }
  };

  return d;
}

// Fills the hole `Duplex.from` calls through, which cannot import this file
// directly because this file builds `Duplex` instances.
setDuplexify(duplexify);
