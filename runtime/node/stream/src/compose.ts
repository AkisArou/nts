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

import {
  AbortError,
  ERR_INVALID_ARG_VALUE,
  ERR_INVALID_RETURN_VALUE,
  ERR_MISSING_ARGS,
} from "../../internal/errors.ts";
import { Duplex } from "./duplex.ts";
import { pipeline } from "./pipeline.ts";
import { destroyer } from "./destroy.ts";
import { eos } from "./end-of-stream.ts";
import {
  isNodeStream,
  isReadable,
  isReadableNodeStream,
  isReadableStream,
  isTransformStream,
  isWebStream,
  isWritable,
  isWritableNodeStream,
  isWritableStream,
} from "./utils.ts";
import type {
  ReadableNodeStreamLike,
  ReadableWebStreamLike,
  WritableWebStreamLike,
} from "./utils.ts";

type WriteCallback = (error?: unknown) => void;

interface FlowControlledReadable extends ReadableNodeStreamLike {
  pause(): unknown;
  resume(): unknown;
}

interface WebWriter {
  readonly ready: Promise<void>;
  write(chunk: unknown): Promise<void>;
  close(): Promise<void>;
}

interface WebReader {
  read(): unknown;
}

interface WebReadResult {
  readonly done: boolean;
  readonly value?: unknown;
}

function isFlowControlledReadable(value: unknown): value is FlowControlledReadable {
  return isReadableNodeStream(value, true) &&
    typeof value.pause === "function" &&
    typeof value.resume === "function";
}

function isWebWriter(value: unknown): value is WebWriter {
  return value !== null && typeof value === "object" &&
    "ready" in value && value.ready instanceof Promise &&
    "write" in value && typeof value.write === "function" &&
    "close" in value && typeof value.close === "function";
}

function isWebReader(value: unknown): value is WebReader {
  return value !== null && typeof value === "object" &&
    "read" in value && typeof value.read === "function";
}

function isWebReadResult(value: unknown): value is WebReadResult {
  return value !== null && typeof value === "object" &&
    "done" in value && typeof value.done === "boolean";
}

function writableWebSide(value: unknown): WritableWebStreamLike | null {
  if (isWritableStream(value)) return value;
  if (isTransformStream(value) && isWritableStream(value.writable)) {
    return value.writable;
  }
  return null;
}

function readableWebSide(value: unknown): ReadableWebStreamLike | null {
  if (isReadableStream(value)) return value;
  if (isTransformStream(value) && isReadableStream(value.readable)) {
    return value.readable;
  }
  return null;
}

function objectMode(value: unknown, name: "readableObjectMode" | "writableObjectMode"): boolean {
  if (value === null || typeof value !== "object") return false;
  return name === "readableObjectMode"
    ? "readableObjectMode" in value && Boolean(value.readableObjectMode)
    : "writableObjectMode" in value && Boolean(value.writableObjectMode);
}

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
    const stream = streams[n];
    if (!isNodeStream(stream) && !isWebStream(stream)) continue;

    // Every stage but the last must be readable, and every stage but the
    // first must be writable — otherwise the chain has a gap, and finding
    // that out when the data stops moving is much worse than finding it now.
    if (
      n < streams.length - 1 &&
      !isReadable(stream) &&
      !isReadableStream(stream) &&
      !isTransformStream(stream)
    ) {
      throw new ERR_INVALID_ARG_VALUE(`streams[${n}]`, original[n], "must be readable");
    }
    if (
      n > 0 &&
      !isWritable(stream) &&
      !isWritableStream(stream) &&
      !isTransformStream(stream)
    ) {
      throw new ERR_INVALID_ARG_VALUE(`streams[${n}]`, original[n], "must be writable");
    }
  }

  let onDrain: WriteCallback | null = null;
  let onFinish: WriteCallback | null = null;
  let onClose: WriteCallback | null = null;
  let composed: Duplex | null = null;

  const head = streams[0];
  const tail = pipeline(streams, (error?: unknown): void => {
    const callback = onClose;
    onClose = null;

    if (callback) callback(error);
    else if (error) composed?.destroy(error);
    // Neither side has anything left to do, so the composed stream is over
    // even though nobody failed.
    else if (!readable && !writable) composed?.destroy();
  });

  const headWebWritable = writableWebSide(head);
  const tailWebReadable = readableWebSide(tail);
  const writable = Boolean(isWritable(head) || headWebWritable !== null);
  const readable = Boolean(isReadable(tail) || tailWebReadable !== null);

  const duplex = new Duplex({
    writableObjectMode: objectMode(head, "writableObjectMode"),
    readableObjectMode: objectMode(tail, "readableObjectMode"),
    writable,
    readable,
  });
  composed = duplex;

  if (writable) {
    if (isWritableNodeStream(head)) {
      duplex._write = (
        chunk: unknown,
        encoding: string | undefined,
        callback: WriteCallback,
      ): void => {
        if (head.write(chunk, encoding)) callback();
        else onDrain = callback;
      };

      duplex._final = (callback: WriteCallback): void => {
        head.end();
        onFinish = callback;
      };

      head.on("drain", () => {
        if (onDrain) {
          const callback = onDrain;
          onDrain = null;
          callback();
        }
      });
    } else if (headWebWritable !== null) {
      const writerValue = headWebWritable.getWriter();
      if (!isWebWriter(writerValue)) {
        throw new ERR_INVALID_RETURN_VALUE("WritableStreamDefaultWriter", "getWriter", writerValue);
      }
      const writer = writerValue;

      duplex._write = async (
        chunk: unknown,
        _encoding: string | undefined,
        callback: WriteCallback,
      ): Promise<void> => {
        try {
          await writer.ready;
          writer.write(chunk).catch(() => {});
          callback();
        } catch (error) {
          callback(error);
        }
      };

      duplex._final = async (callback: WriteCallback): Promise<void> => {
        try {
          await writer.ready;
          writer.close().catch(() => {});
          onFinish = callback;
        } catch (error) {
          callback(error);
        }
      };
    }

    // The composed stream has finished writing when the *tail* is done, not
    // when the head is: everything in between still has to drain.
    eos(tailWebReadable ?? tail, () => {
      if (onFinish) {
        const callback = onFinish;
        onFinish = null;
        callback();
      }
    });
  }

  if (readable) {
    if (isFlowControlledReadable(tail)) {
      // Flowing mode rather than `read()`: the tail is already producing, and
      // pausing it is how backpressure from this duplex reaches the pipeline.
      duplex._read = (): void => {
        tail.resume();
      };

      tail.on("data", (chunk: unknown) => {
        if (!duplex.push(chunk)) tail.pause();
      });

      tail.on("end", () => {
        duplex.push(null);
      });
    } else if (tailWebReadable !== null) {
      const readerValue = tailWebReadable.getReader();
      if (!isWebReader(readerValue)) {
        throw new ERR_INVALID_RETURN_VALUE("ReadableStreamDefaultReader", "getReader", readerValue);
      }
      const reader = readerValue;

      duplex._read = async (): Promise<void> => {
        while (true) {
          try {
            const pending = reader.read();
            if (!(pending instanceof Promise)) {
              throw new ERR_INVALID_RETURN_VALUE("Promise", "read", pending);
            }
            const result = await pending;
            if (!isWebReadResult(result)) {
              throw new ERR_INVALID_RETURN_VALUE("IteratorResult", "read", result);
            }
            if (result.done) {
              duplex.push(null);
              return;
            }
            if (!duplex.push(result.value)) return;
          } catch {
            // The pipeline owns error propagation and destroys this facade.
            return;
          }
        }
      };
    }
  }

  duplex._destroy = (error: unknown, callback: WriteCallback): void => {
    if (!error && onClose !== null) error = new AbortError();

    onDrain = null;
    onFinish = null;

    if (isNodeStream(tail)) destroyer(tail, error);

    if (onClose === null) callback(error);
    else onClose = callback;
  };

  return duplex;
}
