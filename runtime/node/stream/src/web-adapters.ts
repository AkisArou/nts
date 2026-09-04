// Node streams <-> Web Streams adapters, from node v24.20.0
// `lib/internal/webstreams/adapters.js`.
//
// The two stream models put backpressure in different places. Node reports it
// as `write() === false` followed by `drain`; Web Streams report it through a
// promise returned by the writer. These adapters translate that handshake and
// keep cancellation/destruction symmetric in both directions.

import { Buffer } from "../../buffer/src/main.ts";
import {
  AbortError,
  ERR_INVALID_ARG_TYPE,
  ERR_INVALID_ARG_VALUE,
  ERR_INVALID_RETURN_VALUE,
  ERR_STREAM_PREMATURE_CLOSE,
} from "../../internal/errors.ts";
import { triggerUncaughtException } from "../../internal/tick.ts";
import { validateBoolean, validateObject, validateOneOf } from "../../internal/validators.ts";
import { eos } from "./end-of-stream.ts";
import type { AbortSignalLike } from "./end-of-stream.ts";
import {
  isDestroyed,
  isReadable,
  isReadableStream,
  isWritable,
  isWritableEnded,
  isWritableStream,
} from "./utils.ts";
import type { Readable, ReadableOptions } from "./readable.ts";
import type { BufferedWrite, Writable, WritableOptions } from "./writable.ts";
import type { Duplex, DuplexOptions } from "./duplex.ts";

export interface ReadableFromWebOptions {
  highWaterMark?: number | null | undefined;
  encoding?: string | undefined;
  objectMode?: boolean | undefined;
  signal?: AbortSignalLike | undefined;
}

export interface ReadableToWebOptions {
  strategy?: unknown;
  type?: "bytes" | undefined;
}

export interface WritableFromWebOptions {
  decodeStrings?: boolean | undefined;
  highWaterMark?: number | null | undefined;
  objectMode?: boolean | undefined;
  signal?: AbortSignalLike | undefined;
}

export interface DuplexFromWebOptions extends WritableFromWebOptions, ReadableFromWebOptions {
  allowHalfOpen?: boolean | undefined;
}

export interface DuplexToWebOptions {
  readableType?: "bytes" | undefined;
  /** Deprecated Node spelling retained for compatibility. */
  type?: "bytes" | undefined;
}

export interface WebReadableStream {
  getReader(options?: unknown): unknown;
  cancel(reason?: unknown): Promise<void>;
}

export interface WebWritableStream {
  getWriter(): unknown;
  abort(reason?: unknown): Promise<void>;
  close(): Promise<void>;
}

export interface WebDuplexPair {
  readonly readable: WebReadableStream;
  readonly writable: WebWritableStream;
}

interface WebReadResult {
  readonly done: boolean;
  readonly value?: unknown;
}

interface WebReader {
  readonly closed: Promise<void>;
  read(): Promise<unknown>;
  cancel(reason?: unknown): Promise<void>;
}

interface WebWriter {
  readonly ready: Promise<void>;
  readonly closed: Promise<void>;
  write(chunk: unknown): Promise<void>;
  close(): Promise<void>;
  abort(reason?: unknown): Promise<void>;
}

interface ReadableController {
  readonly desiredSize: number | null;
  readonly byobRequest?: { respond(bytesWritten: number): void } | null;
  enqueue(chunk: unknown): void;
  close(): void;
  error(reason?: unknown): void;
}

interface WritableController {
  error(reason?: unknown): void;
}

interface UnderlyingReadableSource {
  type?: "bytes" | undefined;
  start?(controller: ReadableController): void;
  pull?(): void;
  cancel?(reason?: unknown): void;
}

interface UnderlyingWritableSink {
  start?(controller: WritableController): void;
  write?(chunk: unknown): void | Promise<void>;
  close?(): void | Promise<void>;
  abort?(reason?: unknown): void | Promise<void>;
}

interface ReadableStreamConstructor {
  new (source?: UnderlyingReadableSource, strategy?: unknown): WebReadableStream;
}

interface WritableStreamConstructor {
  new (sink?: UnderlyingWritableSink, strategy?: unknown): WebWritableStream;
}

declare const ReadableStream: ReadableStreamConstructor;
declare const WritableStream: WritableStreamConstructor;

interface NodeReadable {
  readonly _readableState: object;
  readonly readableObjectMode?: boolean;
  readonly readableHighWaterMark?: number;
  pause(): unknown;
  resume(): unknown;
  on<Args extends unknown[]>(
    event: string | symbol,
    listener: (...args: Args) => unknown,
  ): unknown;
  destroy(error?: unknown): unknown;
}

interface NodeWritable {
  readonly writableObjectMode?: boolean;
  readonly writableHighWaterMark?: number;
  readonly writableNeedDrain?: boolean;
  on<Args extends unknown[]>(
    event: string | symbol,
    listener: (...args: Args) => unknown,
  ): unknown;
  write(chunk: unknown): boolean;
  end(): unknown;
  destroy(error?: unknown): unknown;
}

type ReadableConstructor = new (options?: ReadableOptions) => Readable;
type WritableConstructor = new (options?: WritableOptions) => Writable;
type DuplexConstructor = new (options?: DuplexOptions) => Duplex;

interface Deferred {
  readonly promise: Promise<void>;
  resolve(): void;
  reject(reason?: unknown): void;
}

function deferred(): Deferred {
  let resolvePromise: (() => void) | null = null;
  let rejectPromise: ((reason?: unknown) => void) | null = null;
  const promise = new Promise<void>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  return {
    promise,
    resolve: (): void => resolvePromise?.(),
    reject: (reason?: unknown): void => rejectPromise?.(reason),
  };
}

function isWebReadResult(value: unknown): value is WebReadResult {
  return value !== null && typeof value === "object" &&
    "done" in value && typeof value.done === "boolean";
}

function isWebReader(value: unknown): value is WebReader {
  return value !== null && typeof value === "object" &&
    "closed" in value && value.closed instanceof Promise &&
    "read" in value && typeof value.read === "function" &&
    "cancel" in value && typeof value.cancel === "function";
}

function isWebWriter(value: unknown): value is WebWriter {
  return value !== null && typeof value === "object" &&
    "ready" in value && value.ready instanceof Promise &&
    "closed" in value && value.closed instanceof Promise &&
    "write" in value && typeof value.write === "function" &&
    "close" in value && typeof value.close === "function" &&
    "abort" in value && typeof value.abort === "function";
}

function isNodeReadable(value: unknown): value is NodeReadable {
  return value !== null && typeof value === "object" &&
    "_readableState" in value && value._readableState !== null &&
    typeof value._readableState === "object" &&
    "pause" in value && typeof value.pause === "function" &&
    "resume" in value && typeof value.resume === "function" &&
    "on" in value && typeof value.on === "function" &&
    "destroy" in value && typeof value.destroy === "function";
}

function isNodeWritable(value: unknown): value is NodeWritable {
  return value !== null && typeof value === "object" &&
    "write" in value && typeof value.write === "function" &&
    "end" in value && typeof value.end === "function" &&
    "on" in value && typeof value.on === "function" &&
    "destroy" in value && typeof value.destroy === "function";
}

function byteSize(chunk: unknown): number {
  if (typeof chunk === "string") return chunk.length;
  if (chunk instanceof ArrayBuffer) return chunk.byteLength;
  if (ArrayBuffer.isView(chunk)) return chunk.byteLength;
  return 1;
}

function reportThrownCallback(error: unknown): void {
  triggerUncaughtException(error);
}

export function newReadableFromWeb(
  ReadableClass: ReadableConstructor,
  readableStream: unknown,
  options?: ReadableFromWebOptions,
): Readable {
  if (!isReadableStream(readableStream)) {
    throw new ERR_INVALID_ARG_TYPE("readableStream", "ReadableStream", readableStream);
  }
  if (options !== undefined) validateObject(options, "options");

  const objectMode = options?.objectMode ?? false;
  validateBoolean(objectMode, "options.objectMode");
  if (options?.encoding !== undefined && !Buffer.isEncoding(options.encoding)) {
    throw new ERR_INVALID_ARG_VALUE("options.encoding", options.encoding);
  }

  const readerValue = readableStream.getReader();
  if (!isWebReader(readerValue)) {
    throw new ERR_INVALID_RETURN_VALUE("ReadableStreamDefaultReader", "getReader", readerValue);
  }
  const reader = readerValue;
  let closed = false;
  let readable: Readable;

  const finishDestroy = (
    error: unknown,
    callback: (error?: unknown) => void,
  ): void => {
    try {
      callback(error);
    } catch (thrown) {
      reportThrownCallback(thrown);
    }
  };

  readable = new ReadableClass({
    objectMode,
    highWaterMark: options?.highWaterMark,
    encoding: options?.encoding,
    signal: options?.signal,
    read: (): void => {
      reader.read().then(
        (result: unknown) => {
          if (!isWebReadResult(result)) {
            readable.destroy(new ERR_INVALID_RETURN_VALUE("IteratorResult", "read", result));
          } else if (result.done) {
            readable.push(null);
          } else {
            readable.push(result.value);
          }
        },
        (error: unknown) => readable.destroy(error),
      );
    },
    destroy: (error: unknown, callback: (error?: unknown) => void): void => {
      if (closed) {
        finishDestroy(error, callback);
        return;
      }
      reader.cancel(error).then(
        () => finishDestroy(error, callback),
        () => finishDestroy(error, callback),
      );
    },
  });

  reader.closed.then(
    () => {
      closed = true;
    },
    (error: unknown) => {
      closed = true;
      readable.destroy(error);
    },
  );
  return readable;
}

export function newReadableToWeb(
  streamReadable: unknown,
  options?: ReadableToWebOptions,
): WebReadableStream {
  if (!isNodeReadable(streamReadable)) {
    throw new ERR_INVALID_ARG_TYPE("streamReadable", "stream.Readable", streamReadable);
  }
  if (options !== undefined) validateObject(options, "options");
  validateOneOf(options?.type, "options.type", ["bytes", undefined]);

  const byteStream = options?.type === "bytes";
  const objectMode = streamReadable.readableObjectMode === true;
  const readable = Boolean(isReadable(streamReadable));
  let controller: ReadableController | null = null;
  let settled = false;

  const source: UnderlyingReadableSource = {
    type: byteStream ? "bytes" : undefined,
    start: (value: ReadableController): void => {
      controller = value;
    },
    cancel: (reason?: unknown): void => {
      settled = true;
      streamReadable.destroy(reason);
    },
  };
  if (readable) {
    source.pull = (): void => {
      streamReadable.resume();
    };
  }

  const highWaterMark = streamReadable.readableHighWaterMark;
  const strategy = byteStream
    ? { highWaterMark }
    : options?.strategy ?? {
      highWaterMark,
      size: objectMode ? (): number => 1 : byteSize,
    };
  const web = new ReadableStream(source, strategy);

  let cleanup = (): void => {};
  cleanup = eos(streamReadable, { writable: false }, (error?: unknown) => {
    cleanup();
    // Legacy streams may emit a late second error. It has already been
    // reflected into the Web stream, so keep it from becoming unhandled.
    streamReadable.on("error", () => {});
    if (settled || controller === null) return;
    settled = true;
    if (error) {
      controller.error(error);
    } else {
      controller.close();
      if (byteStream) controller.byobRequest?.respond(0);
    }
  });

  if (settled) {
    cleanup();
  } else if (readable) {
    streamReadable.pause();
    streamReadable.on("data", (value: unknown) => {
      if (controller === null) return;
      const chunk = value instanceof Uint8Array && !objectMode
        ? new Uint8Array(value)
        : value;
      controller.enqueue(chunk);
      if ((controller.desiredSize ?? 1) <= 0) streamReadable.pause();
    });
  }

  return web;
}

export function newWritableFromWeb(
  WritableClass: WritableConstructor,
  writableStream: unknown,
  options?: WritableFromWebOptions,
): Writable {
  if (!isWritableStream(writableStream)) {
    throw new ERR_INVALID_ARG_TYPE("writableStream", "WritableStream", writableStream);
  }
  if (options !== undefined) validateObject(options, "options");

  const objectMode = options?.objectMode ?? false;
  const decodeStrings = options?.decodeStrings ?? true;
  validateBoolean(objectMode, "options.objectMode");
  validateBoolean(decodeStrings, "options.decodeStrings");

  const writerValue = writableStream.getWriter();
  if (!isWebWriter(writerValue)) {
    throw new ERR_INVALID_RETURN_VALUE("WritableStreamDefaultWriter", "getWriter", writerValue);
  }
  const writer = writerValue;
  let closed = false;
  let writable: Writable;

  const finish = (callback: (error?: unknown) => void, error?: unknown): void => {
    try {
      callback(error);
    } catch (thrown) {
      writable.destroy(thrown);
    }
  };

  writable = new WritableClass({
    highWaterMark: options?.highWaterMark,
    objectMode,
    decodeStrings,
    signal: options?.signal,
    write: (
      chunk: unknown,
      _encoding: string | undefined,
      callback: (error?: unknown) => void,
    ): void => {
      writer.ready.then(() => writer.write(chunk)).then(
        () => finish(callback),
        (error: unknown) => finish(callback, error),
      );
    },
    writev: (chunks: BufferedWrite[], callback: (error?: unknown) => void): void => {
      writer.ready.then(
        () => Promise.all(chunks.map((entry) => writer.write(entry.chunk))),
      ).then(
        () => finish(callback),
        (error: unknown) => finish(callback, error),
      );
    },
    destroy: (error: unknown, callback: (error?: unknown) => void): void => {
      if (closed) {
        finish(callback, error);
        return;
      }
      const operation = error == null ? writer.close() : writer.abort(error);
      operation.then(
        () => finish(callback, error),
        () => finish(callback, error),
      );
    },
    final: (callback: (error?: unknown) => void): void => {
      if (closed) {
        finish(callback);
        return;
      }
      writer.close().then(
        () => finish(callback),
        (error: unknown) => finish(callback, error),
      );
    },
  });

  writer.closed.then(
    () => {
      closed = true;
      if (!isWritableEnded(writable)) {
        writable.destroy(new ERR_STREAM_PREMATURE_CLOSE());
      }
    },
    (error: unknown) => {
      closed = true;
      writable.destroy(error);
    },
  );
  return writable;
}

export function newWritableToWeb(streamWritable: unknown): WebWritableStream {
  if (!isNodeWritable(streamWritable)) {
    throw new ERR_INVALID_ARG_TYPE("streamWritable", "stream.Writable", streamWritable);
  }

  const highWaterMark = streamWritable.writableHighWaterMark;
  const objectMode = streamWritable.writableObjectMode === true;
  if (isDestroyed(streamWritable) || !isWritable(streamWritable)) {
    const closed = new WritableStream();
    void closed.close();
    return closed;
  }

  let controller: WritableController | null = null;
  let backpressure: Deferred | null = null;
  let closing: Deferred | null = null;

  const onDrain = (): void => {
    backpressure?.resolve();
  };
  streamWritable.on("drain", onDrain);

  let cleanup = (): void => {};
  cleanup = eos(streamWritable, { readable: false }, (error?: unknown) => {
    cleanup();
    streamWritable.on("error", () => {});
    if (error != null) {
      backpressure?.reject(error);
      closing?.reject(error);
      closing = null;
      controller?.error(error);
      controller = null;
    } else if (closing !== null) {
      closing.resolve();
      closing = null;
    } else {
      controller?.error(new AbortError());
      controller = null;
    }
  });

  const sink: UnderlyingWritableSink = {
    start: (value: WritableController): void => {
      controller = value;
    },
    write: (value: unknown): void | Promise<void> => {
      let chunk = value;
      if (!objectMode && chunk instanceof ArrayBuffer) chunk = new Uint8Array(chunk);
      if (streamWritable.writableNeedDrain || !streamWritable.write(chunk)) {
        const wait = deferred();
        backpressure = wait;
        if (!streamWritable.writableNeedDrain) wait.resolve();
        return wait.promise.then(() => {
          if (backpressure === wait) backpressure = null;
        });
      }
    },
    abort: (reason?: unknown): void => {
      streamWritable.destroy(reason);
    },
    close: (): Promise<void> => {
      if (closing === null && !isWritableEnded(streamWritable)) {
        closing = deferred();
        streamWritable.end();
        return closing.promise;
      }
      controller = null;
      return Promise.resolve();
    },
  };

  const strategy = {
    highWaterMark,
    size: objectMode ? (): number => 1 : byteSize,
  };
  return new WritableStream(sink, strategy);
}

export function newDuplexFromWeb(
  DuplexClass: DuplexConstructor,
  pair: unknown,
  options?: DuplexFromWebOptions,
): Duplex {
  validateObject(pair, "pair");
  const readableStream = "readable" in pair ? pair.readable : undefined;
  const writableStream = "writable" in pair ? pair.writable : undefined;
  if (!isReadableStream(readableStream)) {
    throw new ERR_INVALID_ARG_TYPE("pair.readable", "ReadableStream", readableStream);
  }
  if (!isWritableStream(writableStream)) {
    throw new ERR_INVALID_ARG_TYPE("pair.writable", "WritableStream", writableStream);
  }
  if (options !== undefined) validateObject(options, "options");

  const objectMode = options?.objectMode ?? false;
  const decodeStrings = options?.decodeStrings ?? true;
  const allowHalfOpen = options?.allowHalfOpen ?? false;
  validateBoolean(objectMode, "options.objectMode");
  validateBoolean(decodeStrings, "options.decodeStrings");
  validateBoolean(allowHalfOpen, "options.allowHalfOpen");
  if (options?.encoding !== undefined && !Buffer.isEncoding(options.encoding)) {
    throw new ERR_INVALID_ARG_VALUE("options.encoding", options.encoding);
  }

  const readerValue = readableStream.getReader();
  const writerValue = writableStream.getWriter();
  if (!isWebReader(readerValue)) {
    throw new ERR_INVALID_RETURN_VALUE("ReadableStreamDefaultReader", "getReader", readerValue);
  }
  if (!isWebWriter(writerValue)) {
    throw new ERR_INVALID_RETURN_VALUE("WritableStreamDefaultWriter", "getWriter", writerValue);
  }
  const reader = readerValue;
  const writer = writerValue;
  let readableClosed = false;
  let writableClosed = false;
  let duplex: Duplex;

  const finish = (callback: (error?: unknown) => void, error?: unknown): void => {
    try {
      callback(error);
    } catch (thrown) {
      duplex.destroy(thrown);
    }
  };

  duplex = new DuplexClass({
    allowHalfOpen,
    objectMode,
    decodeStrings,
    highWaterMark: options?.highWaterMark,
    encoding: options?.encoding,
    signal: options?.signal,
    read: (): void => {
      reader.read().then(
        (result: unknown) => {
          if (!isWebReadResult(result)) {
            duplex.destroy(new ERR_INVALID_RETURN_VALUE("IteratorResult", "read", result));
          } else if (result.done) {
            duplex.push(null);
          } else {
            duplex.push(result.value);
          }
        },
        (error: unknown) => duplex.destroy(error),
      );
    },
    write: (
      chunk: unknown,
      _encoding: string | undefined,
      callback: (error?: unknown) => void,
    ): void => {
      writer.ready.then(() => writer.write(chunk)).then(
        () => finish(callback),
        (error: unknown) => finish(callback, error),
      );
    },
    writev: (chunks: BufferedWrite[], callback: (error?: unknown) => void): void => {
      writer.ready.then(
        () => Promise.all(chunks.map((entry) => writer.write(entry.chunk))),
      ).then(
        () => finish(callback),
        (error: unknown) => finish(callback, error),
      );
    },
    final: (callback: (error?: unknown) => void): void => {
      if (writableClosed) {
        finish(callback);
        return;
      }
      writer.close().then(
        () => finish(callback),
        (error: unknown) => finish(callback, error),
      );
    },
    destroy: (error: unknown, callback: (error?: unknown) => void): void => {
      const cancel = readableClosed ? Promise.resolve() : reader.cancel(error);
      const close = writableClosed
        ? Promise.resolve()
        : error == null ? writer.close() : writer.abort(error);
      Promise.allSettled([cancel, close]).then(() => finish(callback, error));
    },
  });

  reader.closed.then(
    () => {
      readableClosed = true;
    },
    (error: unknown) => {
      readableClosed = true;
      duplex.destroy(error);
    },
  );
  writer.closed.then(
    () => {
      writableClosed = true;
      if (!isWritableEnded(duplex)) duplex.destroy(new ERR_STREAM_PREMATURE_CLOSE());
    },
    (error: unknown) => {
      writableClosed = true;
      duplex.destroy(error);
    },
  );
  return duplex;
}

export function newDuplexToWeb(
  duplex: unknown,
  options?: DuplexToWebOptions,
): WebDuplexPair {
  if (
    duplex === null || typeof duplex !== "object" ||
    !("_readableState" in duplex) || !("_writableState" in duplex)
  ) {
    throw new ERR_INVALID_ARG_TYPE("duplex", "stream.Duplex", duplex);
  }
  if (options !== undefined) validateObject(options, "options");
  const readableType = options?.readableType ?? options?.type;
  validateOneOf(readableType, "options.readableType", ["bytes", undefined]);
  return {
    readable: newReadableToWeb(duplex, { type: readableType }),
    writable: newWritableToWeb(duplex),
  };
}
