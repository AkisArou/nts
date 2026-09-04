// Several streams as one, from node v24.20.0 `lib/internal/streams/compose.js`.
//
// `compose(a, b, c)` gives back a single duplex: writing to it writes to `a`,
// reading from it reads from `c`, and the middle is a pipeline. The difference
// from `pipeline` is what you get back — `pipeline` returns the last stage and
// starts the flow, `compose` returns a *new* stream you can hand on, store, or
// compose again.
//
// The composed stream is a real duplex with its own buffers, which means the
// data is buffered twice: once by the head or tail and once here. Node carries
// a note about avoiding that by giving streams composable traits; until then
// this is the price of the result being an ordinary stream.
//
// The web-stream branches are absent for the reason given in `duplexify.ts`.

import { AbortError, ERR_INVALID_ARG_VALUE, ERR_MISSING_ARGS } from "../../internal/errors.ts";
import { Duplex } from "./duplex.ts";
import type { DuplexOptions } from "./duplex.ts";
import { pipeline } from "./pipeline.ts";
import { destroyer } from "./destroy.ts";
import { eos } from "./end-of-stream.ts";
import { isNodeStream, isReadable, isWritable } from "./utils.ts";

type AnyRecord = Record<string, unknown>;
type WriteCb = (error?: unknown) => void;

export function compose(...streams: unknown[]): Duplex {
  if (streams.length === 0) throw new ERR_MISSING_ARGS("streams");
  if (streams.length === 1) return Duplex.from(streams[0]);

  // Kept for the error messages: once a function has been turned into a
  // duplex, reporting *that* back to the caller would name something they
  // never passed.
  const original = streams.slice();

  if (typeof streams[0] === "function") streams[0] = Duplex.from(streams[0]);
  if (typeof streams[streams.length - 1] === "function") {
    const last = streams.length - 1;
    streams[last] = Duplex.from(streams[last]);
  }

  for (let n = 0; n < streams.length; ++n) {
    if (!isNodeStream(streams[n])) continue;

    // Every stage but the last must be readable, and every stage but the
    // first must be writable — otherwise the chain has a gap, and finding
    // that out when the data stops moving is much worse than finding it now.
    if (n < streams.length - 1 && !isReadable(streams[n])) {
      throw new ERR_INVALID_ARG_VALUE(`streams[${n}]`, original[n], "must be readable");
    }
    if (n > 0 && !isWritable(streams[n])) {
      throw new ERR_INVALID_ARG_VALUE(`streams[${n}]`, original[n], "must be writable");
    }
  }

  let onDrain: WriteCb | null = null;
  let onFinish: WriteCb | null = null;
  let onClose: WriteCb | null = null;

  const finished = (error?: unknown): void => {
    const callback = onClose;
    onClose = null;

    if (callback) callback(error);
    else if (error) d.destroy(error);
    // Neither side has anything left to do, so the composed stream is over
    // even though nobody failed.
    else if (!readable && !writable) d.destroy();
  };

  const head = streams[0] as AnyRecord;
  const tail = pipeline(streams, finished) as AnyRecord;

  const writable = Boolean(isWritable(head));
  const readable = Boolean(isReadable(tail));

  const d: Duplex = new Duplex({
    writableObjectMode: Boolean(head?.["writableObjectMode"]),
    readableObjectMode: Boolean(tail?.["readableObjectMode"]),
    writable,
    readable,
  } as DuplexOptions);

  if (writable) {
    const headStream = head as AnyRecord & {
      write(c: unknown, e: string): boolean;
      end(): void;
      on(e: string, l: () => void): void;
    };

    d._write = function (chunk: unknown, encoding: string, callback: WriteCb): void {
      if (headStream.write(chunk, encoding)) callback();
      else onDrain = callback;
    };

    d._final = function (callback: WriteCb): void {
      headStream.end();
      onFinish = callback;
    };

    headStream.on("drain", () => {
      if (onDrain) {
        const callback = onDrain;
        onDrain = null;
        callback();
      }
    });

    // The composed stream has finished writing when the *tail* is done, not
    // when the head is: everything in between still has to drain.
    eos(tail, () => {
      if (onFinish) {
        const callback = onFinish;
        onFinish = null;
        callback();
      }
    });
  }

  if (readable) {
    const tailStream = tail as AnyRecord & {
      resume(): void;
      pause(): void;
      on(e: string, l: (chunk?: unknown) => void): void;
    };

    // Flowing mode rather than `read()`: the tail is already producing, and
    // pausing it is how backpressure from the composed stream reaches back
    // through the whole chain.
    d._read = function (): void {
      tailStream.resume();
    };

    tailStream.on("data", (chunk: unknown) => {
      if (!d.push(chunk)) tailStream.pause();
    });

    tailStream.on("end", () => {
      d.push(null);
    });
  }

  d._destroy = function (error: unknown, callback: WriteCb): void {
    if (!error && onClose !== null) error = new AbortError();

    onDrain = null;
    onFinish = null;

    if (isNodeStream(tail)) destroyer(tail, error);

    if (onClose === null) callback(error);
    else onClose = callback;
  };

  return d;
}
