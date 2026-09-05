// Interop between classic Node streams and Node v24.20.0's `stream/iter`
// source and Writer contracts.

import { Buffer } from "../../../buffer/src/main.ts";
import {
  AbortError,
  ERR_INVALID_ARG_TYPE,
  ERR_INVALID_ARG_VALUE,
  ERR_INVALID_STATE,
  ERR_INVALID_STATE_RANGE,
  ERR_STREAM_WRITE_AFTER_END,
} from "../../../internal/errors.ts";
import {
  validateInteger,
  validateObject,
} from "../../../internal/validators.ts";
import { addAbortSignalNoValidate } from "../add-abort-signal.ts";
import { eos } from "../end-of-stream.ts";
import { Readable } from "../readable.ts";
import type { ReadableOptions } from "../readable.ts";
import { Writable } from "../writable.ts";
import type {
  BufferedWrite,
  WritableOptions,
  WriteCallback,
} from "../writable.ts";
import {
  classicReadableSource,
  isClassicReadable,
} from "./classic-source.ts";
import { from } from "./from.ts";
import { drainableProtocol, hasToAsyncStreamable, toAsyncStreamable } from "./types.ts";
import {
  type AsyncByteStream,
  type AsyncWriter,
  type BackpressurePolicy,
  type ByteBatch,
  getWriterSignal,
  isAsyncIterable,
  isAsyncWriter,
  isSyncIterable,
  type StreamAbortSignal,
  toUint8Array,
  validateBackpressure,
  type WriterOptions,
} from "./utils.ts";

declare function nts_enqueue_microtask(callback: () => void): void;

const DEFAULT_READABLE_HIGH_WATER_MARK = 64 * 1024;
const DEFAULT_WRITABLE_HIGH_WATER_MARK = 16_384;

interface Deferred<T> {
  readonly promise: Promise<T>;
  resolve(value: T): void;
  reject(reason?: unknown): void;
}

function deferred<T>(): Deferred<T> {
  let resolve: (value: T) => void = (): void => {};
  let reject: (reason?: unknown) => void = (): void => {};
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

const fromReadableCache = new WeakMap<object, AsyncByteStream>();

/** Convert a classic Readable, or a compatible duck type, to a byte source. */
export function fromReadable(readable: unknown): AsyncByteStream {
  if (readable === null || typeof readable !== "object") {
    throw new ERR_INVALID_ARG_TYPE("readable", "Readable", readable);
  }

  const cached = fromReadableCache.get(readable);
  if (cached !== undefined) return cached;

  if (hasToAsyncStreamable(readable)) {
    const result = from(readable[toAsyncStreamable]());
    fromReadableCache.set(readable, result);
    return result;
  }

  if (!isClassicReadable(readable)) {
    throw new ERR_INVALID_ARG_TYPE("readable", "Readable", readable);
  }

  const source = classicReadableSource(readable);
  fromReadableCache.set(readable, source);
  return source;
}

export interface ToReadableOptions {
  highWaterMark?: number;
  signal?: StreamAbortSignal;
}

function readableOptions(value: unknown): Required<Pick<ToReadableOptions, "highWaterMark">> &
  Pick<ToReadableOptions, "signal"> {
  if (value === undefined) return { highWaterMark: DEFAULT_READABLE_HIGH_WATER_MARK };
  validateObject(value, "options");
  const highWaterMark = "highWaterMark" in value && value.highWaterMark !== undefined
    ? value.highWaterMark
    : DEFAULT_READABLE_HIGH_WATER_MARK;
  validateInteger(highWaterMark, "options.highWaterMark", 0);
  const signal = "signal" in value ? value.signal : undefined;
  validateReadableSignal(signal);
  return { highWaterMark, signal };
}

function validateReadableSignal(
  signal: unknown,
): asserts signal is StreamAbortSignal | undefined {
  if (
    signal !== undefined &&
    (signal === null || typeof signal !== "object" || !("aborted" in signal))
  ) {
    throw new ERR_INVALID_ARG_TYPE("options.signal", "AbortSignal", signal);
  }
}

class AsyncReadableController {
  readonly #iterator: AsyncIterator<unknown>;
  #readable: Readable | null = null;
  #backpressure: Deferred<void> | null = null;
  #pumping = false;
  #done = false;

  constructor(iterator: AsyncIterator<unknown>) {
    this.#iterator = iterator;
  }

  attach(readable: Readable): void {
    this.#readable = readable;
  }

  read(): void {
    const backpressure = this.#backpressure;
    if (backpressure !== null) {
      this.#backpressure = null;
      backpressure.resolve(undefined);
    } else if (!this.#pumping && !this.#done) {
      this.#pumping = true;
      void this.#pump();
    }
  }

  destroy(error: unknown, callback: WriteCallback): void {
    this.#done = true;
    const backpressure = this.#backpressure;
    if (backpressure !== null) {
      this.#backpressure = null;
      backpressure.resolve(undefined);
    }

    if (this.#iterator.return === undefined) {
      callback(error);
      return;
    }
    try {
      Promise.resolve(this.#iterator.return()).then(
        (): void => callback(error),
        (returnError: unknown): void => callback(returnError || error),
      );
    } catch (returnError) {
      callback(returnError || error);
    }
  }

  async #pump(): Promise<void> {
    const readable = this.#readable;
    if (readable === null) return;
    try {
      while (!this.#done) {
        const result = await this.#iterator.next();
        if (result.done) {
          this.#done = true;
          readable.push(null);
          return;
        }
        if (!Array.isArray(result.value)) {
          throw new ERR_INVALID_ARG_TYPE("batch", "Array", result.value);
        }
        const batch = result.value;
        for (let i = 0; i < batch.length; i++) {
          const chunk = batch[i];
          if (!(chunk instanceof Uint8Array)) {
            throw new ERR_INVALID_ARG_TYPE("chunk", "Uint8Array", chunk);
          }
          if (!readable.push(chunk)) {
            this.#backpressure = deferred<void>();
            await this.#backpressure.promise;
            if (this.#done) return;
          }
        }
      }
    } catch (error) {
      this.#done = true;
      readable.destroy(error);
    }
  }
}

/** Create a classic byte-mode Readable backed by an asynchronous byte source. */
export function toReadable(source: unknown, options?: unknown): Readable {
  if (!isAsyncIterable(source)) {
    throw new ERR_INVALID_ARG_TYPE("source", "AsyncIterable", source);
  }
  const parsed = readableOptions(options);
  const controller = new AsyncReadableController(source[Symbol.asyncIterator]());
  const readable = new Readable({
    highWaterMark: parsed.highWaterMark,
    read: (): void => controller.read(),
    destroy: (error, callback): void => controller.destroy(error, callback),
  });
  controller.attach(readable);
  if (parsed.signal !== undefined) addAbortSignalNoValidate(parsed.signal, readable);
  return readable;
}

class SyncReadableController {
  readonly #iterator: Iterator<unknown>;
  #readable: Readable | null = null;
  #batch: unknown[] | null = null;
  #batchIndex = 0;

  constructor(iterator: Iterator<unknown>) {
    this.#iterator = iterator;
  }

  attach(readable: Readable): void {
    this.#readable = readable;
  }

  read(): void {
    const readable = this.#readable;
    if (readable === null) return;
    for (;;) {
      const batch = this.#batch;
      if (batch !== null) {
        while (this.#batchIndex < batch.length) {
          const chunk = batch[this.#batchIndex];
          this.#batchIndex++;
          if (!(chunk instanceof Uint8Array)) {
            throw new ERR_INVALID_ARG_TYPE("chunk", "Uint8Array", chunk);
          }
          if (!readable.push(chunk)) return;
        }
        this.#batch = null;
        this.#batchIndex = 0;
      }

      const result = this.#iterator.next();
      if (result.done) {
        readable.push(null);
        return;
      }
      if (!Array.isArray(result.value)) {
        throw new ERR_INVALID_ARG_TYPE("batch", "Array", result.value);
      }
      this.#batch = result.value;
    }
  }

  destroy(error: unknown, callback: WriteCallback): void {
    this.#batch = null;
    this.#batchIndex = 0;
    try {
      this.#iterator.return?.();
      callback(error);
    } catch (returnError) {
      callback(returnError || error);
    }
  }
}

/** Create a classic byte-mode Readable backed by a synchronous byte source. */
export function toReadableSync(source: unknown, options?: unknown): Readable {
  if (!isSyncIterable(source)) {
    throw new ERR_INVALID_ARG_TYPE("source", "Iterable", source);
  }
  const parsed = readableOptions(options);
  const controller = new SyncReadableController(source[Symbol.iterator]());
  const readableOptionsValue: ReadableOptions = {
    highWaterMark: parsed.highWaterMark,
    read: (): void => controller.read(),
    destroy: (error, callback): void => controller.destroy(error, callback),
  };
  const readable = new Readable(readableOptionsValue);
  controller.attach(readable);
  return readable;
}

interface ClassicWritableLike {
  readonly destroyed?: boolean;
  readonly writableEnded?: boolean;
  readonly writableFinished?: boolean;
  readonly writableHighWaterMark?: number;
  readonly writableLength?: number;
  readonly writableObjectMode?: boolean;
  write(chunk: Uint8Array): boolean;
  end(): unknown;
  on<Args extends unknown[]>(
    event: string,
    listener: (...args: Args) => unknown,
  ): unknown;
  removeListener<Args extends unknown[]>(
    event: string,
    listener: (...args: Args) => unknown,
  ): unknown;
  cork?(): void;
  uncork?(): void;
  destroy?(error?: unknown): unknown;
}

function isClassicWritable(value: unknown): value is ClassicWritableLike {
  return value !== null &&
    (typeof value === "object" || typeof value === "function") &&
    "write" in value &&
    typeof value.write === "function" &&
    "on" in value &&
    typeof value.on === "function" &&
    "removeListener" in value &&
    typeof value.removeListener === "function";
}

class DrainWaiter {
  readonly resolve: () => void;
  readonly reject: (reason?: unknown) => void;

  constructor(resolve: () => void, reject: (reason?: unknown) => void) {
    this.resolve = resolve;
    this.reject = reject;
  }
}

class ClassicWritableWriter implements AsyncWriter {
  readonly #writable: ClassicWritableLike;
  readonly #backpressure: BackpressurePolicy;
  readonly #highWaterMark: number;
  #totalBytes = 0;
  #waiters: DrainWaiter[] = [];
  #listenersInstalled = false;

  readonly #onDrain = (): void => this.#settleWaiters(true);
  readonly #onError = (error: unknown): void => this.#settleWaiters(false, error);

  constructor(
    writable: ClassicWritableLike,
    backpressure: BackpressurePolicy,
  ) {
    this.#writable = writable;
    this.#backpressure = backpressure;
    this.#highWaterMark = writable.writableHighWaterMark ??
      DEFAULT_WRITABLE_HIGH_WATER_MARK;
  }

  get canWrite(): boolean | null {
    if (!this.#isWritable()) return null;
    return !this.#isFull();
  }

  writeSync(_chunk: Uint8Array): false {
    return false;
  }

  writevSync(_chunks: ByteBatch): false {
    return false;
  }

  write(
    chunk: string | Uint8Array,
    options?: WriterOptions,
  ): Promise<void> {
    getWriterSignal(options);
    if (!this.#isWritable()) {
      return Promise.reject(new ERR_STREAM_WRITE_AFTER_END());
    }

    let bytes: Uint8Array;
    try {
      bytes = toUint8Array(chunk);
    } catch (error) {
      return Promise.reject(error);
    }

    if (this.#backpressure === "strict" && this.#isFull()) {
      return Promise.reject(new ERR_INVALID_STATE_RANGE(
        "Backpressure violation: buffer is full. " +
        "Await each write() call to respect backpressure.",
      ));
    }
    if (this.#backpressure === "drop-newest" && this.#isFull()) {
      this.#totalBytes += bytes.byteLength;
      return Promise.resolve();
    }

    this.#totalBytes += bytes.byteLength;
    const canContinue = this.#writable.write(bytes);
    if (canContinue || this.#backpressure !== "unbounded") {
      return Promise.resolve();
    }
    return this.#waitForDrain();
  }

  writev(
    chunks: ByteBatch | readonly (string | Uint8Array)[],
    options?: WriterOptions,
  ): Promise<void> {
    if (!Array.isArray(chunks)) {
      throw new ERR_INVALID_ARG_TYPE("chunks", "Array", chunks);
    }
    getWriterSignal(options);
    if (!this.#isWritable()) {
      return Promise.reject(new ERR_STREAM_WRITE_AFTER_END());
    }
    if (this.#backpressure === "strict" && this.#isFull()) {
      return Promise.reject(new ERR_INVALID_STATE_RANGE(
        "Backpressure violation: buffer is full. " +
        "Await each write() call to respect backpressure.",
      ));
    }
    if (this.#backpressure === "drop-newest" && this.#isFull()) {
      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        if (chunk !== undefined) this.#totalBytes += toUint8Array(chunk).byteLength;
      }
      return Promise.resolve();
    }

    let canContinue = true;
    if (this.#writable.cork !== undefined && this.#writable.uncork !== undefined) {
      this.#writable.cork();
      try {
        canContinue = this.#writeChunks(chunks);
      } finally {
        this.#writable.uncork();
      }
    } else {
      canContinue = this.#writeChunks(chunks);
    }

    if (canContinue || this.#backpressure !== "unbounded") {
      return Promise.resolve();
    }
    return this.#waitForDrain();
  }

  endSync(): -1 {
    return -1;
  }

  end(options?: WriterOptions): Promise<number> {
    getWriterSignal(options);
    if (this.#writable.writableFinished || this.#writable.destroyed) {
      this.#cleanup();
      return Promise.resolve(this.#totalBytes);
    }

    const pending = deferred<number>();
    if (!this.#writable.writableEnded) this.#writable.end();
    eos(this.#writable, { writable: true, readable: false }, (error) => {
      this.#cleanup(error);
      if (error) pending.reject(error);
      else pending.resolve(this.#totalBytes);
    });
    return pending.promise;
  }

  fail(reason?: unknown): void {
    this.#cleanup(reason);
    this.#writable.destroy?.(reason);
  }

  [Symbol.asyncDispose](): Promise<void> {
    if (this.#isWritable()) {
      this.#cleanup();
      this.#writable.destroy?.();
    }
    return Promise.resolve();
  }

  [Symbol.dispose](): void {
    if (this.#isWritable()) {
      this.#cleanup();
      this.#writable.destroy?.();
    }
  }

  [drainableProtocol](): Promise<boolean> | null {
    if (!this.#isWritable()) return null;
    if (!this.#isFull()) return Promise.resolve(true);
    return new Promise<boolean>((resolve) => {
      this.#waiters.push(new DrainWaiter(
        (): void => resolve(true),
        (): void => resolve(false),
      ));
      this.#installListeners();
    });
  }

  #isWritable(): boolean {
    return !this.#writable.destroyed &&
      !this.#writable.writableFinished &&
      !this.#writable.writableEnded;
  }

  #isFull(): boolean {
    return (this.#writable.writableLength ?? 0) >= this.#highWaterMark;
  }

  #writeChunks(chunks: readonly (string | Uint8Array)[]): boolean {
    let canContinue = true;
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      if (chunk === undefined) continue;
      const bytes = toUint8Array(chunk);
      this.#totalBytes += bytes.byteLength;
      canContinue = this.#writable.write(bytes);
    }
    return canContinue;
  }

  #waitForDrain(): Promise<void> {
    const pending = deferred<void>();
    this.#waiters.push(new DrainWaiter(
      (): void => pending.resolve(undefined),
      pending.reject,
    ));
    this.#installListeners();
    return pending.promise;
  }

  #installListeners(): void {
    if (this.#listenersInstalled) return;
    this.#listenersInstalled = true;
    this.#writable.on("drain", this.#onDrain);
    this.#writable.on("error", this.#onError);
  }

  #settleWaiters(success: boolean, error?: unknown): void {
    const waiters = this.#waiters;
    this.#waiters = [];
    for (let i = 0; i < waiters.length; i++) {
      const waiter = waiters[i];
      if (waiter === undefined) continue;
      if (success) waiter.resolve();
      else waiter.reject(error);
    }
  }

  #cleanup(error?: unknown): void {
    this.#settleWaiters(false, error ?? new AbortError());
    if (!this.#listenersInstalled) return;
    this.#listenersInstalled = false;
    this.#writable.removeListener("drain", this.#onDrain);
    this.#writable.removeListener("error", this.#onError);
  }
}

const fromWritableCache = new WeakMap<
  ClassicWritableLike,
  Map<BackpressurePolicy, ClassicWritableWriter>
>();

/** Convert a classic Writable into a cached bytes-only Writer adapter. */
export function fromWritable(
  writable: unknown,
  options: unknown = {},
): ClassicWritableWriter {
  if (!isClassicWritable(writable)) {
    throw new ERR_INVALID_ARG_TYPE("writable", "Writable", writable);
  }
  validateObject(options, "options");
  const candidate = "backpressure" in options ? options.backpressure : undefined;
  const backpressure = candidate ?? "strict";
  validateBackpressure(backpressure);

  if (writable.writableObjectMode) {
    throw new ERR_INVALID_STATE(
      "Cannot create a stream/iter Writer from an object-mode Writable",
    );
  }
  if (backpressure === "drop-oldest") {
    throw new ERR_INVALID_ARG_VALUE(
      "options.backpressure",
      backpressure,
      "drop-oldest is not supported for classic stream.Writable",
    );
  }

  let byBackpressure = fromWritableCache.get(writable);
  if (byBackpressure === undefined) {
    byBackpressure = new Map<BackpressurePolicy, ClassicWritableWriter>();
    fromWritableCache.set(writable, byBackpressure);
  }
  const cached = byBackpressure.get(backpressure);
  if (cached !== undefined) return cached;

  const writer = new ClassicWritableWriter(writable, backpressure);
  byBackpressure.set(backpressure, writer);
  return writer;
}

function writerChunk(chunk: unknown, encoding: string | undefined): Uint8Array {
  if (typeof chunk === "string") return Buffer.from(chunk, encoding);
  if (chunk instanceof Uint8Array) return chunk;
  throw new ERR_INVALID_ARG_TYPE("chunk", ["string", "Uint8Array"], chunk);
}

/** Create a classic Writable whose sink is a stream/iter Writer. */
export function toWritable(writer: unknown): Writable {
  if (!isAsyncWriter(writer)) {
    throw new ERR_INVALID_ARG_TYPE("writer", "Writer", writer);
  }

  const write = (
    chunk: unknown,
    encoding: string | undefined,
    callback: WriteCallback,
  ): void => {
    const bytes = writerChunk(chunk, encoding);
    if (writer.writeSync !== undefined) {
      try {
        if (writer.writeSync(bytes)) {
          nts_enqueue_microtask(callback);
          return;
        }
      } catch (error) {
        callback(error);
        return;
      }
    }
    try {
      Promise.resolve(writer.write(bytes)).then(
        (): void => callback(),
        callback,
      );
    } catch (error) {
      callback(error);
    }
  };

  const writev = (entries: BufferedWrite[], callback: WriteCallback): void => {
    const chunks = new Array<Uint8Array>(entries.length);
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      if (entry !== undefined) chunks[i] = writerChunk(entry.chunk, entry.encoding);
    }

    if (writer.writevSync !== undefined) {
      try {
        if (writer.writevSync(chunks)) {
          nts_enqueue_microtask(callback);
          return;
        }
      } catch (error) {
        callback(error);
        return;
      }
    }
    try {
      if (writer.writev === undefined) {
        throw new ERR_INVALID_STATE("Writer does not implement writev");
      }
      Promise.resolve(writer.writev(chunks)).then(
        (): void => callback(),
        callback,
      );
    } catch (error) {
      callback(error);
    }
  };

  const final = (callback: WriteCallback): void => {
    if (writer.end === undefined) {
      nts_enqueue_microtask(callback);
      return;
    }
    if (writer.endSync !== undefined) {
      try {
        if (writer.endSync() >= 0) {
          nts_enqueue_microtask(callback);
          return;
        }
      } catch (error) {
        callback(error);
        return;
      }
    }
    try {
      Promise.resolve(writer.end()).then(
        (): void => callback(),
        callback,
      );
    } catch (error) {
      callback(error);
    }
  };

  const destroy = (error: unknown, callback: WriteCallback): void => {
    if (error && writer.fail !== undefined) writer.fail(error);
    callback();
  };

  const baseOptions: WritableOptions = {
    highWaterMark: Number.MAX_SAFE_INTEGER,
    write,
    final,
    destroy,
  };
  if (writer.writev === undefined) return new Writable(baseOptions);
  return new Writable({
    highWaterMark: baseOptions.highWaterMark,
    write,
    writev,
    final,
    destroy,
  });
}
