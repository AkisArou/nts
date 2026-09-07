import { LimitError } from "../core/errors.ts";
import { ignoreRejection } from "../core/promise.ts";
import { AbortSignal } from "../core/abort.ts";
import { abortSignalBrand } from "../core/abort-brand.ts";
import { coerceToBoolean, coerceToDOMString, requireDictionary } from "../core/webidl.ts";
import { Fifo } from "./fifo.ts";
import { QueueWithSizes } from "./queue-with-sizes.ts";
import {
  extractHighWaterMark,
  extractSizeAlgorithm,
  type QueuingStrategy,
  type QueuingStrategySize,
} from "./queuing-strategy.ts";
import {
  acquireWritableStreamDefaultWriter,
  isWritableStream,
  WritableStream,
  writableStreamCanAcceptWrites,
  writableStreamDefaultWriterAbort,
  writableStreamDefaultWriterClosed,
  writableStreamDefaultWriterCloseWithErrorPropagation,
  writableStreamDefaultWriterReady,
  writableStreamDefaultWriterRelease,
  writableStreamDefaultWriterWrite,
  writableStreamIsClosingOrClosed,
  writableStreamIsErrored,
  writableStreamIsWritable,
  writableStreamStoredError,
  type WritableStreamDefaultWriter,
} from "./writable.ts";

export type ReadResult<T> = { done: false; value: T } | { done: true; value: undefined };

export type UnderlyingSourceStartCallback<T> = (
  this: UnderlyingSource<T>,
  controller: ReadableStreamDefaultController<T>,
) => void | PromiseLike<void>;
export type UnderlyingSourcePullCallback<T> = (
  this: UnderlyingSource<T>,
  controller: ReadableStreamDefaultController<T>,
) => void | PromiseLike<void>;
export type UnderlyingSourceCancelCallback<T> = (
  this: UnderlyingSource<T>,
  reason: unknown,
) => void | PromiseLike<void>;

export interface UnderlyingSource<T> {
  start?: UnderlyingSourceStartCallback<T>;
  pull?: UnderlyingSourcePullCallback<T>;
  cancel?: UnderlyingSourceCancelCallback<T>;
  type?: undefined;
}

export type UnderlyingByteSourceStartCallback = (
  this: UnderlyingByteSource,
  controller: ReadableByteStreamController,
) => void | PromiseLike<void>;
export type UnderlyingByteSourcePullCallback = (
  this: UnderlyingByteSource,
  controller: ReadableByteStreamController,
) => void | PromiseLike<void>;
export type UnderlyingByteSourceCancelCallback = (
  this: UnderlyingByteSource,
  reason: unknown,
) => void | PromiseLike<void>;

export interface UnderlyingByteSource {
  autoAllocateChunkSize?: number;
  start?: UnderlyingByteSourceStartCallback;
  pull?: UnderlyingByteSourcePullCallback;
  cancel?: UnderlyingByteSourceCancelCallback;
  type: "bytes";
}

export interface ReadableStreamBYOBReaderReadOptions {
  min?: number;
}

export type ReadableStreamBYOBView = ArrayBufferView<ArrayBuffer>;
export type ReadableStreamBYOBReadResult<TView extends ReadableStreamBYOBView> =
  | { done: false; value: TView }
  | { done: true; value: TView | undefined };

export interface ReadableStreamGetReaderOptions {
  mode?: unknown;
}

export interface ReadableStreamIteratorOptions {
  preventCancel?: unknown;
}

type IteratorResultLike<T> =
  | { readonly done?: false; readonly value: T }
  | { readonly done: true; readonly value?: unknown };

interface IteratorLike<T> {
  next(this: IteratorLike<T>): IteratorResultLike<T> | PromiseLike<IteratorResultLike<T>>;
  return?:
    | ((
        this: IteratorLike<T>,
        reason: unknown,
      ) => IteratorResultLike<unknown> | PromiseLike<IteratorResultLike<unknown>>)
    | null;
}

interface ReadableStreamFromIterable<T> {
  [Symbol.asyncIterator]?: ((this: ReadableStreamFromIterable<T>) => IteratorLike<T>) | null;
  [Symbol.iterator]?: ((this: ReadableStreamFromIterable<T>) => IteratorLike<T>) | null;
}

export interface StreamPipeOptions {
  preventAbort?: unknown;
  preventCancel?: unknown;
  preventClose?: unknown;
  signal?: AbortSignal;
}

export interface ReadableWritablePair<R, W> {
  readonly readable: ReadableStream<R>;
  readonly writable: WritableStream<W>;
}

interface ConvertedPipeOptions {
  readonly preventAbort: boolean;
  readonly preventCancel: boolean;
  readonly preventClose: boolean;
  readonly signal: AbortSignal | undefined;
}

type StreamState = "readable" | "closed" | "errored";

const readableStreamBrand: unique symbol = Symbol("ReadableStream brand");
const readableStreamStateName: unique symbol = Symbol("ReadableStream state name");
const readableStreamStoredErrorValue: unique symbol = Symbol("ReadableStream stored error");

interface ReadableByteStreamHost {
  readonly [readableStreamStateName]: StreamState;
  fail(error: unknown): void;
  finishByteStream(settleReads?: boolean): void;
}

interface ReadableStreamBYOBHost extends ReadableByteStreamHost {
  attachBYOB(reader: ReadableStreamBYOBReader): void;
  cancelInternal(reason: unknown): Promise<void>;
  readInto(
    reader: ReadableStreamBYOBReader,
    view: ReadableStreamBYOBView,
    minimumElements: number,
  ): Promise<ReadableStreamBYOBReadResult<ReadableStreamBYOBView>>;
  releaseBYOB(reader: ReadableStreamBYOBReader): void;
}
const defaultReadableSource = {
  cancel: undefined,
  pull: undefined,
  start: undefined,
  type: undefined,
};
const defaultReadableStrategy = {
  highWaterMark: undefined,
  size: undefined,
};
const defaultReaderOptions = { mode: undefined };
const defaultBYOBReadOptions = { min: undefined };
const defaultPipeOptions = {
  preventAbort: undefined,
  preventCancel: undefined,
  preventClose: undefined,
  signal: undefined,
};
const defaultIteratorOptions = { preventCancel: undefined };

function countChunk<T>(_value: T): number {
  return 1;
}

function identity<T>(value: T): T {
  return value;
}

function isUnderlyingByteSource<T>(
  source: UnderlyingSource<T> | UnderlyingByteSource,
): source is UnderlyingByteSource {
  const type: unknown = source.type;
  if (type === undefined) return false;
  if (coerceToDOMString(type) !== "bytes") {
    throw new TypeError("ReadableStream source type is not supported");
  }
  return true;
}

function convertPipeOptions(options: StreamPipeOptions | null): ConvertedPipeOptions {
  requireDictionary(options, "Stream pipe options");
  if (options === null) {
    return {
      preventAbort: false,
      preventCancel: false,
      preventClose: false,
      signal: undefined,
    };
  }
  const preventAbort = coerceToBoolean(options.preventAbort);
  const preventCancel = coerceToBoolean(options.preventCancel);
  const preventClose = coerceToBoolean(options.preventClose);
  const signal = options.signal;
  if (
    signal !== undefined &&
    (signal === null ||
      typeof signal !== "object" ||
      !(abortSignalBrand in signal) ||
      signal[abortSignalBrand] !== true)
  ) {
    throw new TypeError("Stream pipe signal must be an AbortSignal");
  }
  return { preventAbort, preventCancel, preventClose, signal };
}

function isReadableStream<T>(value: unknown): value is ReadableStream<T> {
  return value instanceof ReadableStream && value[readableStreamBrand] === true;
}

/**
 * Default-reader Streams implementation. Reads are pull-driven, with a single
 * in-flight underlying pull and explicit ownership; byte/BYOB support is separate.
 */
export class ReadableStream<T> {
  readonly [readableStreamBrand] = true;
  #source: UnderlyingSource<T> | null = null;
  #controller: ReadableStreamDefaultController<T> | null = null;
  #byteState: ReadableByteStreamState | null = null;
  #highWaterMark = 0;
  #sizeOf: QueuingStrategySize<T> | undefined;
  #pullAlgorithm: UnderlyingSourcePullCallback<T> | undefined;
  #cancelAlgorithm: UnderlyingSourceCancelCallback<T> | undefined;
  readonly #queue = new QueueWithSizes<T>();
  readonly #pending = new Fifo<PromiseWithResolvers<ReadResult<T>>>();
  #currentReader: ReadableStreamDefaultReader<T> | ReadableStreamBYOBReader | null = null;
  #state: StreamState = "readable";
  #storedError: unknown;
  #closeRequested = false;
  #started = false;
  #pulling = false;
  #pullAgain = false;
  #isDisturbed = false;

  constructor(source: UnderlyingByteSource, strategy?: QueuingStrategy<Uint8Array> | null);
  constructor(source?: UnderlyingSource<T> | null, strategy?: QueuingStrategy<T> | null);
  constructor(
    source: UnderlyingSource<T> | UnderlyingByteSource | null = defaultReadableSource,
    strategy: QueuingStrategy<T> | null = defaultReadableStrategy,
  ) {
    requireDictionary(source, "Underlying source");
    if (source === null) {
      throw new TypeError("Underlying source must be an object");
    }

    requireDictionary(strategy, "Queuing strategy");
    const size = strategy === null ? undefined : strategy.size;
    const highWaterMark = strategy === null ? undefined : strategy.highWaterMark;
    if (isUnderlyingByteSource(source)) {
      if (size !== undefined) {
        throw new RangeError("Byte stream strategy must not provide size");
      }
      this.#highWaterMark = extractHighWaterMark(
        highWaterMark === undefined ? null : { highWaterMark },
        0,
      );
      const byteState = new ReadableByteStreamState(this, source, this.#highWaterMark);
      this.#byteState = byteState;
      return;
    }

    this.#sizeOf = extractSizeAlgorithm(strategy);
    this.#highWaterMark = extractHighWaterMark(strategy, 1);
    const startAlgorithm = source.start;
    if (startAlgorithm !== undefined && typeof startAlgorithm !== "function") {
      throw new TypeError("Underlying source start must be callable");
    }
    const pullAlgorithm = source.pull;
    if (pullAlgorithm !== undefined && typeof pullAlgorithm !== "function") {
      throw new TypeError("Underlying source pull must be callable");
    }
    const cancelAlgorithm = source.cancel;
    if (cancelAlgorithm !== undefined && typeof cancelAlgorithm !== "function") {
      throw new TypeError("Underlying source cancel must be callable");
    }

    this.#source = source;
    this.#pullAlgorithm = pullAlgorithm;
    this.#cancelAlgorithm = cancelAlgorithm;
    this.#controller = new ReadableStreamDefaultController(readableControllerKey, this);
    let startResult: void | PromiseLike<void>;
    try {
      startResult = startAlgorithm?.call(source, this.#controller);
    } catch (error) {
      this.#clearAlgorithms();
      throw error;
    }
    this.#observeStart(startResult);
  }

  static from<T>(asyncIterable: AsyncIterable<T> | Iterable<T | PromiseLike<T>>): ReadableStream<T>;
  static from<T>(asyncIterable: ReadableStreamFromIterable<T>): ReadableStream<T> {
    const asyncIteratorMethod = asyncIterable[Symbol.asyncIterator];
    if (asyncIteratorMethod !== undefined && asyncIteratorMethod !== null) {
      if (typeof asyncIteratorMethod !== "function") {
        throw new TypeError("ReadableStream.from input has a non-callable async iterator");
      }
      const iterator = asyncIteratorMethod.call(asyncIterable);
      if (iterator === null || typeof iterator !== "object") {
        throw new TypeError("ReadableStream.from async iterator must be an object");
      }
      return readableStreamFromIterator(iterator, true);
    }

    const iteratorMethod = asyncIterable[Symbol.iterator];
    if (iteratorMethod === undefined || iteratorMethod === null) {
      throw new TypeError("ReadableStream.from input must be an async iterable or iterable");
    }
    if (typeof iteratorMethod !== "function") {
      throw new TypeError("ReadableStream.from input has a non-callable iterator");
    }
    const iterator = iteratorMethod.call(asyncIterable);
    if (iterator === null || typeof iterator !== "object") {
      throw new TypeError("ReadableStream.from iterator must be an object");
    }
    return readableStreamFromIterator(iterator, false);
  }

  get locked(): boolean {
    return this.#currentReader !== null;
  }

  /** @internal */ get byteStream(): boolean {
    return this.#byteState !== null;
  }

  /** @internal */ get disturbed(): boolean {
    return this.#isDisturbed;
  }

  /** @internal */ get [readableStreamStateName](): StreamState {
    return this.#state;
  }

  /** @internal */ get [readableStreamStoredErrorValue](): unknown {
    return this.#storedError;
  }

  /** @internal */ get queuedSize(): number {
    const byteState = this.#byteState;
    return byteState === null ? this.#queue.totalSize : byteState.queuedSize;
  }

  /** @internal */ get canCloseOrEnqueue(): boolean {
    const byteState = this.#byteState;
    return byteState === null
      ? this.#state === "readable" && !this.#closeRequested
      : byteState.canCloseOrEnqueue;
  }

  /** @internal */ markDisturbed(): void {
    this.#isDisturbed = true;
  }

  getReader(options: { mode: "byob" }): ReadableStreamBYOBReader;
  getReader(options?: { mode?: undefined } | null): ReadableStreamDefaultReader<T>;
  getReader(
    options: ReadableStreamGetReaderOptions | null = defaultReaderOptions,
  ): ReadableStreamDefaultReader<T> | ReadableStreamBYOBReader {
    requireDictionary(options, "ReadableStream reader options");
    const mode = options?.mode;
    if (mode !== undefined) {
      if (coerceToDOMString(mode) !== "byob") {
        throw new TypeError("ReadableStream reader mode is invalid");
      }
      if (this.#byteState === null) {
        throw new TypeError("A BYOB reader requires a byte stream");
      }
      if (this.locked) {
        throw new TypeError("Stream is locked");
      }
      return new ReadableStreamBYOBReader(this);
    }
    if (this.locked) {
      throw new TypeError("Stream is locked");
    }
    return new ReadableStreamDefaultReader(this);
  }

  /** @internal */ attach(reader: ReadableStreamDefaultReader<T>): void {
    if (this.locked) {
      throw new TypeError("Stream is locked");
    }
    this.#currentReader = reader;
    if (this.#state === "closed") {
      reader.finish();
    }
    if (this.#state === "errored") {
      reader.fail(this.#storedError);
    }
  }

  /** @internal */ attachBYOB(reader: ReadableStreamBYOBReader): void {
    if (this.locked) {
      throw new TypeError("Stream is locked");
    }
    if (this.#byteState === null) {
      throw new TypeError("A BYOB reader requires a byte stream");
    }
    this.#currentReader = reader;
    if (this.#state === "closed") {
      reader.finish();
    }
    if (this.#state === "errored") {
      reader.fail(this.#storedError);
    }
  }

  cancel(reason: unknown = undefined): Promise<void> {
    if (this.locked) {
      return Promise.reject(new TypeError("Stream is locked"));
    }
    return this.cancelInternal(reason);
  }

  pipeThrough<R>(
    transform: ReadableWritablePair<R, T>,
    options: StreamPipeOptions | null = defaultPipeOptions,
  ): ReadableStream<R> {
    if (!isReadableStream<T>(this)) {
      throw new TypeError("ReadableStream method called on an incompatible receiver");
    }
    if (transform === null || typeof transform !== "object") {
      throw new TypeError("Stream transform must be a readable/writable pair");
    }
    const readable = transform.readable;
    if (!isReadableStream<R>(readable)) {
      throw new TypeError("Stream transform must contain a readable stream");
    }
    const writable = transform.writable;
    if (!isWritableStream<T>(writable)) {
      throw new TypeError("Stream transform must contain a writable stream");
    }
    const converted = convertPipeOptions(options);
    if (this.locked) {
      throw new TypeError("ReadableStream is locked");
    }
    if (writable.locked) {
      throw new TypeError("WritableStream is locked");
    }
    const piping = startPipe(this, writable, converted);
    ignoreRejection(piping);
    return readable;
  }

  pipeTo(
    destination: WritableStream<T>,
    options: StreamPipeOptions | null = defaultPipeOptions,
  ): Promise<void> {
    try {
      if (!isReadableStream<T>(this)) {
        throw new TypeError("ReadableStream method called on an incompatible receiver");
      }
      if (!isWritableStream<T>(destination)) {
        throw new TypeError("Destination must be a WritableStream");
      }
      const converted = convertPipeOptions(options);
      if (this.locked) {
        throw new TypeError("ReadableStream is locked");
      }
      if (destination.locked) {
        throw new TypeError("WritableStream is locked");
      }
      return startPipe(this, destination, converted);
    } catch (error) {
      return Promise.reject(error);
    }
  }

  /** @internal */ async cancelInternal(reason: unknown): Promise<void> {
    this.#isDisturbed = true;
    if (this.#state === "closed") {
      return;
    }
    if (this.#state === "errored") {
      throw this.#storedError;
    }
    const byteState = this.#byteState;
    if (byteState !== null) {
      const cancellation = byteState.cancel(reason);
      this.#finish(true);
      await cancellation;
      return;
    }

    const source = this.#source;
    const cancelAlgorithm = this.#cancelAlgorithm;
    this.#queue.reset();
    this.#finish();
    if (source !== null && cancelAlgorithm !== undefined) {
      await cancelAlgorithm.call(source, reason);
    }
  }

  /** @internal */ read(reader: ReadableStreamDefaultReader<T>): Promise<ReadResult<T>>;
  /** @internal */ read(reader: ReadableStreamDefaultReader<T>): Promise<ReadResult<unknown>> {
    if (reader !== this.#currentReader) {
      return Promise.reject(new TypeError("Reader has been released"));
    }
    this.#isDisturbed = true;
    if (this.#state === "closed") {
      return Promise.resolve({ done: true, value: undefined });
    }
    if (this.#state === "errored") {
      return Promise.reject(this.#storedError);
    }
    const byteState = this.#byteState;
    if (byteState !== null) {
      return byteState.readDefault();
    }
    const entry = this.#queue.dequeue();
    if (entry !== undefined) {
      if (this.#closeRequested && this.#queue.empty) {
        this.#finish();
      } else {
        this.#maybePull();
      }
      return Promise.resolve({ done: false, value: entry.value });
    }
    const result = Promise.withResolvers<ReadResult<T>>();
    this.#pending.enqueue(result);
    this.#maybePull();
    return result.promise;
  }

  /** @internal */ release(reader: ReadableStreamDefaultReader<T>): void {
    if (reader !== this.#currentReader) {
      return;
    }
    this.#currentReader = null;
    const error = new TypeError("Reader has been released");
    const byteState = this.#byteState;
    if (byteState === null) {
      this.#rejectPending(error);
    } else {
      byteState.releaseDefault(error);
    }
    reader.released(error);
  }

  /** @internal */ readInto(
    reader: ReadableStreamBYOBReader,
    view: ReadableStreamBYOBView,
    minimumElements: number,
  ): Promise<ReadableStreamBYOBReadResult<ReadableStreamBYOBView>> {
    if (reader !== this.#currentReader) {
      return Promise.reject(new TypeError("Reader has been released"));
    }
    this.#isDisturbed = true;
    if (this.#state === "errored") {
      return Promise.reject(this.#storedError);
    }
    const byteState = this.#byteState;
    if (byteState === null) {
      return Promise.reject(new TypeError("A BYOB reader requires a byte stream"));
    }
    return byteState.readInto(view, minimumElements, this.#state === "closed");
  }

  /** @internal */ releaseBYOB(reader: ReadableStreamBYOBReader): void {
    if (reader !== this.#currentReader) {
      return;
    }
    this.#currentReader = null;
    const error = new TypeError("Reader has been released");
    this.#byteState?.releaseBYOB(error);
    reader.released(error);
  }

  /** @internal */ enqueue(value: T): void {
    if (this.#byteState !== null) {
      throw new TypeError("A byte stream can only be enqueued through its byte controller");
    }
    if (this.#state !== "readable" || this.#closeRequested) {
      throw new TypeError("Stream is not writable");
    }
    const read = this.#takePending();
    if (read !== undefined) {
      read.resolve({ done: false, value });
    } else {
      try {
        const sizeOf = this.#sizeOf;
        this.#queue.enqueue(value, sizeOf === undefined ? 1 : sizeOf(value));
      } catch (error) {
        this.fail(error);
        throw error;
      }
    }
    this.#maybePull();
  }

  /** @internal */ requestClose(): void {
    const byteState = this.#byteState;
    if (byteState !== null) {
      byteState.requestClose();
      return;
    }
    if (this.#state !== "readable" || this.#closeRequested) {
      throw new TypeError("Stream cannot be closed twice");
    }
    this.#closeRequested = true;
    if (this.#queue.empty) {
      this.#finish();
    }
  }

  #finish(settleByteReads = false): void {
    if (this.#state !== "readable") {
      return;
    }
    this.#state = "closed";
    const byteState = this.#byteState;
    if (byteState === null) {
      this.#clearAlgorithms();
    } else {
      byteState.finish(settleByteReads);
    }
    this.#currentReader?.finish();
    this.#resolvePendingAsClosed();
  }

  /** @internal */ finishByteStream(settleReads = false): void {
    this.#finish(settleReads);
  }

  /** @internal */ fail(error: unknown): void {
    if (this.#state !== "readable") {
      return;
    }
    this.#state = "errored";
    this.#storedError = error;
    const byteState = this.#byteState;
    if (byteState === null) {
      this.#queue.reset();
      this.#clearAlgorithms();
    } else {
      byteState.fail(error);
    }
    this.#currentReader?.fail(error);
    this.#rejectPending(error);
  }

  /** @internal */ get desiredSize(): number | null {
    if (this.#state === "errored") {
      return null;
    }
    if (this.#state === "closed") {
      return 0;
    }
    const byteState = this.#byteState;
    return byteState === null ? this.#highWaterMark - this.#queue.totalSize : byteState.desiredSize;
  }

  async #observeStart(startResult: void | PromiseLike<void>): Promise<void> {
    try {
      await startResult;
      this.#started = true;
      this.#maybePull();
    } catch (error) {
      this.fail(error);
    }
  }

  #maybePull(): void {
    if (!this.#started || this.#state !== "readable" || this.#closeRequested) {
      return;
    }
    if (this.#pending.empty && this.#highWaterMark <= this.#queue.totalSize) {
      return;
    }
    if (this.#pulling) {
      this.#pullAgain = true;
      return;
    }
    const source = this.#source;
    const pullAlgorithm = this.#pullAlgorithm;
    const controller = this.#controller;
    if (source === null || pullAlgorithm === undefined || controller === null) {
      return;
    }
    this.#pulling = true;
    let pullResult: void | PromiseLike<void>;
    try {
      pullResult = pullAlgorithm.call(source, controller);
    } catch (error) {
      this.#pulling = false;
      this.fail(error);
      return;
    }
    this.#observePull(pullResult);
  }

  async #observePull(pullResult: void | PromiseLike<void>): Promise<void> {
    try {
      await pullResult;
      this.#pulling = false;
      if (this.#pullAgain) {
        this.#pullAgain = false;
        this.#maybePull();
      }
    } catch (error) {
      this.#pulling = false;
      this.fail(error);
    }
  }

  #takePending(): PromiseWithResolvers<ReadResult<T>> | undefined {
    return this.#pending.dequeue();
  }

  #resolvePendingAsClosed(): void {
    while (!this.#pending.empty) {
      this.#pending.dequeue()?.resolve({ done: true, value: undefined });
    }
  }

  #rejectPending(error: unknown): void {
    while (!this.#pending.empty) {
      this.#pending.dequeue()?.reject(error);
    }
  }

  #clearAlgorithms(): void {
    this.#source = null;
    this.#pullAlgorithm = undefined;
    this.#cancelAlgorithm = undefined;
    this.#sizeOf = undefined;
  }

  tee(): [ReadableStream<T>, ReadableStream<T>] {
    return tee(this);
  }

  values(
    options: ReadableStreamIteratorOptions | null = defaultIteratorOptions,
  ): AsyncIterableIterator<T> {
    requireDictionary(options, "ReadableStream iterator options");
    const preventCancel = options === null ? false : coerceToBoolean(options.preventCancel);
    return new ReadableStreamAsyncIterator(this, preventCancel);
  }

  [Symbol.asyncIterator](
    options: ReadableStreamIteratorOptions | null = defaultIteratorOptions,
  ): AsyncIterableIterator<T> {
    return this.values(options);
  }


  // Web IDL surface shape; see core/interface-tag.ts for the rule and why it is
  // written inline rather than through a helper.
  static {
    Object.defineProperty(this.prototype, Symbol.toStringTag, {
      value: "ReadableStream",
      writable: false,
      enumerable: false,
      configurable: true,
    });
  }
}

type AsyncIteratorRequest<T> =
  | {
      readonly kind: "next";
      readonly result: PromiseWithResolvers<IteratorResult<T, unknown>>;
    }
  | {
      readonly kind: "return";
      readonly value: unknown;
      readonly result: PromiseWithResolvers<IteratorResult<T, unknown>>;
    };

class ReadableStreamAsyncIterator<T> implements AsyncIterableIterator<T> {
  #stream: ReadableStream<T> | null;
  #reader: ReadableStreamDefaultReader<T> | null;
  readonly #preventCancel: boolean;
  readonly #requests = new Fifo<AsyncIteratorRequest<T>>();
  #processing = false;

  constructor(stream: ReadableStream<T>, preventCancel: boolean) {
    this.#stream = stream;
    this.#reader = new ReadableStreamDefaultReader(stream);
    this.#preventCancel = preventCancel;
  }

  next(): Promise<IteratorResult<T, unknown>> {
    const result = Promise.withResolvers<IteratorResult<T, unknown>>();
    this.#requests.enqueue({ kind: "next", result });
    this.#process();
    return result.promise;
  }

  return(value?: unknown): Promise<IteratorResult<T, unknown>> {
    const result = Promise.withResolvers<IteratorResult<T, unknown>>();
    this.#requests.enqueue({ kind: "return", value, result });
    this.#process();
    return result.promise;
  }

  [Symbol.asyncIterator](): AsyncIterableIterator<T> {
    return this;
  }

  #process(): void {
    if (this.#processing) {
      return;
    }
    this.#processing = true;
    void this.#drain();
  }

  async #drain(): Promise<void> {
    while (!this.#requests.empty) {
      const request = this.#requests.dequeue();
      if (request === undefined) {
        break;
      }
      if (request.kind === "next") {
        await this.#next(request.result);
      } else {
        await this.#return(request.value, request.result);
      }
    }
    this.#processing = false;
    if (!this.#requests.empty) {
      this.#process();
    }
  }

  async #next(result: PromiseWithResolvers<IteratorResult<T, unknown>>): Promise<void> {
    const stream = this.#stream;
    const reader = this.#reader;
    if (stream === null || reader === null) {
      result.resolve({ done: true, value: undefined });
      return;
    }

    try {
      const read = await stream.read(reader);
      if (read.done) {
        this.#release();
        result.resolve({ done: true, value: undefined });
      } else {
        result.resolve({ done: false, value: read.value });
      }
    } catch (error) {
      this.#release();
      result.reject(error);
    }
  }

  async #return(
    value: unknown,
    result: PromiseWithResolvers<IteratorResult<T, unknown>>,
  ): Promise<void> {
    const stream = this.#stream;
    const reader = this.#reader;
    if (stream === null || reader === null) {
      result.resolve({ done: true, value });
      return;
    }

    const cancellation = this.#preventCancel ? Promise.resolve() : stream.cancelInternal(value);
    this.#release();
    try {
      await cancellation;
      result.resolve({ done: true, value });
    } catch (error) {
      result.reject(error);
    }
  }

  #release(): void {
    const stream = this.#stream;
    const reader = this.#reader;
    if (stream !== null && reader !== null) {
      stream.release(reader);
    }
    this.#stream = null;
    this.#reader = null;
  }
}

class ReadableStreamIteratorSource<T> implements UnderlyingSource<T> {
  readonly #iterator: IteratorLike<T>;
  readonly #next: IteratorLike<T>["next"];
  readonly #isAsync: boolean;
  #finished = false;

  constructor(iterator: IteratorLike<T>, isAsync: boolean) {
    const next = iterator.next;
    if (typeof next !== "function") {
      throw new TypeError("ReadableStream.from iterator has no callable next method");
    }
    this.#iterator = iterator;
    this.#next = next;
    this.#isAsync = isAsync;
  }

  async pull(controller: ReadableStreamDefaultController<T>): Promise<void> {
    const iteration = await this.#next.call(this.#iterator);
    if (iteration === null || typeof iteration !== "object") {
      throw new TypeError("ReadableStream.from iterator result must be an object");
    }
    if (iteration.done) {
      this.#finished = true;
      controller.close();
      return;
    }
    const value = this.#isAsync ? iteration.value : await iteration.value;
    controller.enqueue(value);
  }

  async cancel(reason: unknown): Promise<void> {
    if (this.#finished) {
      return;
    }
    this.#finished = true;
    const returnMethod = this.#iterator.return;
    if (returnMethod === undefined || returnMethod === null) {
      return;
    }
    if (typeof returnMethod !== "function") {
      throw new TypeError("ReadableStream.from iterator has a non-callable return method");
    }
    const result = await returnMethod.call(this.#iterator, reason);
    if (result === null || typeof result !== "object") {
      throw new TypeError("ReadableStream.from iterator return result must be an object");
    }
  }
}

function readableStreamFromIterator<T>(
  iterator: IteratorLike<T>,
  isAsync: boolean,
): ReadableStream<T> {
  return new ReadableStream(new ReadableStreamIteratorSource(iterator, isAsync), {
    highWaterMark: 0,
  });
}

const readableControllerKey: unique symbol = Symbol("construct ReadableStreamDefaultController");

export class ReadableStreamDefaultController<T> {
  readonly #stream: ReadableStream<T>;

  constructor(...args: [typeof readableControllerKey, ReadableStream<T>]) {
    const key = args[0];
    const stream = args[1];
    if (key !== readableControllerKey || stream === undefined) {
      throw new TypeError("Illegal constructor");
    }
    this.#stream = stream;
  }

  get desiredSize(): number | null {
    return this.#stream.desiredSize;
  }

  enqueue(chunk: T): void {
    this.#stream.enqueue(chunk);
  }

  close(): void {
    this.#stream.requestClose();
  }

  error(reason: unknown = undefined): void {
    this.#stream.fail(reason);
  }


  // Web IDL surface shape; see core/interface-tag.ts for the rule and why it is
  // written inline rather than through a helper.
  static {
    Object.defineProperty(this.prototype, Symbol.toStringTag, {
      value: "ReadableStreamDefaultController",
      writable: false,
      enumerable: false,
      configurable: true,
    });
  }
}

type ByteViewKind =
  | "data"
  | "int8"
  | "uint8"
  | "uint8-clamped"
  | "int16"
  | "uint16"
  | "float16"
  | "int32"
  | "uint32"
  | "float32"
  | "float64"
  | "bigint64"
  | "biguint64";

type PullIntoReaderKind = "default" | "byob" | "none";

class ByteQueueEntry {
  buffer: ArrayBuffer;
  byteOffset: number;
  byteLength: number;

  constructor(buffer: ArrayBuffer, byteOffset: number, byteLength: number) {
    this.buffer = buffer;
    this.byteOffset = byteOffset;
    this.byteLength = byteLength;
  }
}

class PullIntoDescriptor {
  buffer: ArrayBuffer;
  readonly bufferByteLength: number;
  readonly byteOffset: number;
  readonly byteLength: number;
  bytesFilled = 0;
  readonly minimumFillBytes: number;
  readonly elementSize: number;
  readonly viewKind: ByteViewKind;
  readerKind: PullIntoReaderKind;
  defaultResult: PromiseWithResolvers<ReadResult<unknown>> | null;
  byobResult: PromiseWithResolvers<ReadableStreamBYOBReadResult<ReadableStreamBYOBView>> | null;

  constructor(
    buffer: ArrayBuffer,
    bufferByteLength: number,
    byteOffset: number,
    byteLength: number,
    minimumFillBytes: number,
    elementSize: number,
    viewKind: ByteViewKind,
    readerKind: PullIntoReaderKind,
    defaultResult: PromiseWithResolvers<ReadResult<unknown>> | null,
    byobResult: PromiseWithResolvers<ReadableStreamBYOBReadResult<ReadableStreamBYOBView>> | null,
  ) {
    this.buffer = buffer;
    this.bufferByteLength = bufferByteLength;
    this.byteOffset = byteOffset;
    this.byteLength = byteLength;
    this.minimumFillBytes = minimumFillBytes;
    this.elementSize = elementSize;
    this.viewKind = viewKind;
    this.readerKind = readerKind;
    this.defaultResult = defaultResult;
    this.byobResult = byobResult;
  }
}

function isTransferableView(value: unknown): value is ReadableStreamBYOBView {
  return ArrayBuffer.isView(value) && value.buffer instanceof ArrayBuffer;
}

function byteViewKind(view: ReadableStreamBYOBView): ByteViewKind {
  if (view instanceof DataView) return "data";
  if (view instanceof Int8Array) return "int8";
  if (view instanceof Uint8ClampedArray) return "uint8-clamped";
  if (view instanceof Uint8Array) return "uint8";
  if (view instanceof Int16Array) return "int16";
  if (view instanceof Uint16Array) return "uint16";
  if (view instanceof Float16Array) return "float16";
  if (view instanceof Int32Array) return "int32";
  if (view instanceof Uint32Array) return "uint32";
  if (view instanceof Float32Array) return "float32";
  if (view instanceof Float64Array) return "float64";
  if (view instanceof BigInt64Array) return "bigint64";
  if (view instanceof BigUint64Array) return "biguint64";
  throw new TypeError("Unsupported ArrayBuffer view");
}

function byteViewElementSize(kind: ByteViewKind): number {
  switch (kind) {
    case "data":
    case "int8":
    case "uint8":
    case "uint8-clamped":
      return 1;
    case "int16":
    case "uint16":
    case "float16":
      return 2;
    case "int32":
    case "uint32":
    case "float32":
      return 4;
    case "float64":
    case "bigint64":
    case "biguint64":
      return 8;
  }
}

function createByteView(
  kind: ByteViewKind,
  buffer: ArrayBuffer,
  byteOffset: number,
  byteLength: number,
): ReadableStreamBYOBView {
  switch (kind) {
    case "data":
      return new DataView(buffer, byteOffset, byteLength);
    case "int8":
      return new Int8Array(buffer, byteOffset, byteLength);
    case "uint8":
      return new Uint8Array(buffer, byteOffset, byteLength);
    case "uint8-clamped":
      return new Uint8ClampedArray(buffer, byteOffset, byteLength);
    case "int16":
      return new Int16Array(buffer, byteOffset, byteLength / 2);
    case "uint16":
      return new Uint16Array(buffer, byteOffset, byteLength / 2);
    case "float16":
      return new Float16Array(buffer, byteOffset, byteLength / 2);
    case "int32":
      return new Int32Array(buffer, byteOffset, byteLength / 4);
    case "uint32":
      return new Uint32Array(buffer, byteOffset, byteLength / 4);
    case "float32":
      return new Float32Array(buffer, byteOffset, byteLength / 4);
    case "float64":
      return new Float64Array(buffer, byteOffset, byteLength / 8);
    case "bigint64":
      return new BigInt64Array(buffer, byteOffset, byteLength / 8);
    case "biguint64":
      return new BigUint64Array(buffer, byteOffset, byteLength / 8);
  }
}

function enforceRangeUnsignedLongLong(value: number, name: string): number {
  const number = +value;
  if (!Number.isFinite(number)) {
    throw new TypeError(name + " must be a finite number");
  }
  const integer = Math.trunc(number);
  if (integer < 0 || integer > Number.MAX_SAFE_INTEGER) {
    throw new TypeError(name + " is outside the unsigned long long range");
  }
  return integer;
}

const byteControllerKey: unique symbol = Symbol("construct ReadableByteStreamController");
const byobRequestKey: unique symbol = Symbol("construct ReadableStreamBYOBRequest");

export class ReadableStreamBYOBRequest {
  #state: ReadableByteStreamState | null;
  #view: ReadableStreamBYOBView | null;

  constructor(...args: [typeof byobRequestKey, ReadableByteStreamState, ReadableStreamBYOBView]) {
    if (args[0] !== byobRequestKey || args[1] === undefined || args[2] === undefined) {
      throw new TypeError("Illegal constructor");
    }
    this.#state = args[1];
    this.#view = args[2];
  }

  get view(): ReadableStreamBYOBView | null {
    return this.#view;
  }

  respond(bytesWritten: number): void {
    const state = this.#state;
    const view = this.#view;
    if (state === null || view === null) {
      throw new TypeError("This BYOB request has been invalidated");
    }
    if (view.buffer.detached) {
      throw new TypeError("Viewed ArrayBuffer is detached");
    }
    state.respond(enforceRangeUnsignedLongLong(bytesWritten, "bytesWritten"));
  }

  respondWithNewView(view: ReadableStreamBYOBView): void {
    const state = this.#state;
    if (state === null || this.#view === null) {
      throw new TypeError("This BYOB request has been invalidated");
    }
    if (!isTransferableView(view) || view.buffer.detached) {
      throw new TypeError("View must have a transferable ArrayBuffer");
    }
    state.respondWithNewView(view);
  }

  /** @internal */ invalidate(): void {
    this.#state = null;
    this.#view = null;
  }


  // Web IDL surface shape; see core/interface-tag.ts for the rule and why it is
  // written inline rather than through a helper.
  static {
    Object.defineProperty(this.prototype, Symbol.toStringTag, {
      value: "ReadableStreamBYOBRequest",
      writable: false,
      enumerable: false,
      configurable: true,
    });
  }
}

export class ReadableByteStreamController {
  readonly #state: ReadableByteStreamState;

  constructor(...args: [typeof byteControllerKey, ReadableByteStreamState]) {
    if (args[0] !== byteControllerKey || args[1] === undefined) {
      throw new TypeError("Illegal constructor");
    }
    this.#state = args[1];
  }

  get byobRequest(): ReadableStreamBYOBRequest | null {
    return this.#state.byobRequest;
  }

  get desiredSize(): number | null {
    return this.#state.desiredSize;
  }

  close(): void {
    this.#state.requestClose();
  }

  enqueue(chunk: ReadableStreamBYOBView): void {
    if (!isTransferableView(chunk)) {
      throw new TypeError("Byte stream chunks must be ArrayBuffer views");
    }
    if (chunk.byteLength === 0 || chunk.buffer.byteLength === 0 || chunk.buffer.detached) {
      throw new TypeError("Byte stream chunk must have a non-empty attached buffer");
    }
    this.#state.enqueue(chunk);
  }

  error(reason: unknown = undefined): void {
    this.#state.stream.fail(reason);
  }


  // Web IDL surface shape; see core/interface-tag.ts for the rule and why it is
  // written inline rather than through a helper.
  static {
    Object.defineProperty(this.prototype, Symbol.toStringTag, {
      value: "ReadableByteStreamController",
      writable: false,
      enumerable: false,
      configurable: true,
    });
  }
}

export class ReadableStreamBYOBReader {
  #stream: ReadableStreamBYOBHost | null;
  #closedCapability = Promise.withResolvers<void>();
  #closedState: "pending" | "fulfilled" | "rejected" = "pending";

  constructor(stream: ReadableStreamBYOBHost) {
    if (!(stream instanceof ReadableStream)) {
      throw new TypeError("stream must be a ReadableStream");
    }
    this.#stream = stream;
    ignoreRejection(this.closed);
    stream.attachBYOB(this);
  }

  get closed(): Promise<void> {
    return this.#closedCapability.promise;
  }

  async read<TView extends ReadableStreamBYOBView>(
    view: TView,
    options?: ReadableStreamBYOBReaderReadOptions | null,
  ): Promise<ReadableStreamBYOBReadResult<TView>>;
  async read(
    view: ReadableStreamBYOBView,
    options: ReadableStreamBYOBReaderReadOptions | null = defaultBYOBReadOptions,
  ): Promise<ReadableStreamBYOBReadResult<ReadableStreamBYOBView>> {
    if (!isTransferableView(view)) {
      throw new TypeError("BYOB read requires an ArrayBuffer view");
    }
    requireDictionary(options, "BYOB read options");
    if (view.byteLength === 0 || view.buffer.byteLength === 0 || view.buffer.detached) {
      throw new TypeError("BYOB read requires a non-empty attached buffer");
    }
    const kind = byteViewKind(view);
    const elementSize = byteViewElementSize(kind);
    const minimumElements = enforceRangeUnsignedLongLong(options?.min ?? 1, "options.min");
    if (minimumElements === 0) {
      throw new TypeError("options.min must be greater than zero");
    }
    const maximumElements = kind === "data" ? view.byteLength : view.byteLength / elementSize;
    if (minimumElements > maximumElements) {
      throw new RangeError("options.min exceeds the view length");
    }
    const stream = this.#stream;
    if (stream === null) {
      throw new TypeError("Reader has been released");
    }
    return await stream.readInto(this, view, minimumElements);
  }

  cancel(reason: unknown = undefined): Promise<void> {
    const stream = this.#stream;
    return stream === null
      ? Promise.reject(new TypeError("Reader has been released"))
      : stream.cancelInternal(reason);
  }

  releaseLock(): void {
    this.#stream?.releaseBYOB(this);
    this.#stream = null;
  }

  /** @internal */ released(error: unknown): void {
    if (this.#closedState !== "pending") {
      this.#closedCapability = Promise.withResolvers<void>();
      this.#closedState = "pending";
      ignoreRejection(this.closed);
    }
    this.#closedState = "rejected";
    this.#closedCapability.reject(error);
  }

  /** @internal */ finish(): void {
    if (this.#closedState !== "pending") return;
    this.#closedState = "fulfilled";
    this.#closedCapability.resolve();
  }

  /** @internal */ fail(error: unknown): void {
    if (this.#closedState !== "pending") return;
    this.#closedState = "rejected";
    this.#closedCapability.reject(error);
  }


  // Web IDL surface shape; see core/interface-tag.ts for the rule and why it is
  // written inline rather than through a helper.
  static {
    Object.defineProperty(this.prototype, Symbol.toStringTag, {
      value: "ReadableStreamBYOBReader",
      writable: false,
      enumerable: false,
      configurable: true,
    });
  }
}

class ReadableByteStreamState {
  readonly stream: ReadableByteStreamHost;
  readonly #controller: ReadableByteStreamController;
  #source: UnderlyingByteSource | null;
  #pullAlgorithm: UnderlyingByteSourcePullCallback | undefined;
  #cancelAlgorithm: UnderlyingByteSourceCancelCallback | undefined;
  readonly #highWaterMark: number;
  readonly #autoAllocateChunkSize: number | undefined;
  readonly #queue = new Fifo<ByteQueueEntry>();
  #queueTotalSize = 0;
  readonly #defaultReads = new Fifo<PromiseWithResolvers<ReadResult<unknown>>>();
  readonly #pullIntos = new Fifo<PullIntoDescriptor>();
  #currentBYOBRequest: ReadableStreamBYOBRequest | null = null;
  #closeRequested = false;
  #started = false;
  #pulling = false;
  #pullAgain = false;

  constructor(stream: ReadableByteStreamHost, source: UnderlyingByteSource, highWaterMark: number) {
    const start = source.start;
    const pull = source.pull;
    const cancel = source.cancel;
    if (start !== undefined && typeof start !== "function") {
      throw new TypeError("Underlying byte source start must be callable");
    }
    if (pull !== undefined && typeof pull !== "function") {
      throw new TypeError("Underlying byte source pull must be callable");
    }
    if (cancel !== undefined && typeof cancel !== "function") {
      throw new TypeError("Underlying byte source cancel must be callable");
    }
    const rawAutoAllocateChunkSize = source.autoAllocateChunkSize;
    const autoAllocateChunkSize =
      rawAutoAllocateChunkSize === undefined
        ? undefined
        : enforceRangeUnsignedLongLong(rawAutoAllocateChunkSize, "autoAllocateChunkSize");
    if (autoAllocateChunkSize === 0) {
      throw new TypeError("autoAllocateChunkSize must be greater than zero");
    }

    this.stream = stream;
    this.#source = source;
    this.#pullAlgorithm = pull;
    this.#cancelAlgorithm = cancel;
    this.#highWaterMark = highWaterMark;
    this.#autoAllocateChunkSize = autoAllocateChunkSize;
    this.#controller = new ReadableByteStreamController(byteControllerKey, this);

    let startResult: void | PromiseLike<void>;
    try {
      startResult = start?.call(source, this.#controller);
    } catch (error) {
      this.#clearAlgorithms();
      throw error;
    }
    this.#observeStart(startResult);
  }

  get queuedSize(): number {
    return this.#queueTotalSize;
  }

  get canCloseOrEnqueue(): boolean {
    return this.stream[readableStreamStateName] === "readable" && !this.#closeRequested;
  }

  get desiredSize(): number | null {
    const state = this.stream[readableStreamStateName];
    if (state === "errored") return null;
    if (state === "closed") return 0;
    return this.#highWaterMark - this.#queueTotalSize;
  }

  get byobRequest(): ReadableStreamBYOBRequest | null {
    if (this.#currentBYOBRequest === null) {
      const descriptor = this.#pullIntos.peek();
      if (descriptor !== undefined) {
        const remaining = createByteView(
          "uint8",
          descriptor.buffer,
          descriptor.byteOffset + descriptor.bytesFilled,
          descriptor.byteLength - descriptor.bytesFilled,
        );
        this.#currentBYOBRequest = new ReadableStreamBYOBRequest(byobRequestKey, this, remaining);
      }
    }
    return this.#currentBYOBRequest;
  }

  readDefault(): Promise<ReadResult<unknown>> {
    if (this.#queueTotalSize > 0) {
      return Promise.resolve({ done: false, value: this.#dequeueChunk() });
    }
    const result = Promise.withResolvers<ReadResult<unknown>>();
    const autoAllocateChunkSize = this.#autoAllocateChunkSize;
    if (autoAllocateChunkSize === undefined) {
      this.#defaultReads.enqueue(result);
    } else {
      this.#pullIntos.enqueue(
        new PullIntoDescriptor(
          new ArrayBuffer(autoAllocateChunkSize),
          autoAllocateChunkSize,
          0,
          autoAllocateChunkSize,
          1,
          1,
          "uint8",
          "default",
          result,
          null,
        ),
      );
    }
    this.#maybePull();
    return result.promise;
  }

  readInto(
    view: ReadableStreamBYOBView,
    minimumElements: number,
    closed: boolean,
  ): Promise<ReadableStreamBYOBReadResult<ReadableStreamBYOBView>> {
    const kind = byteViewKind(view);
    const elementSize = byteViewElementSize(kind);
    const bufferByteLength = view.buffer.byteLength;
    const byteOffset = view.byteOffset;
    const byteLength = view.byteLength;
    const transferred = view.buffer.transfer();
    const result = Promise.withResolvers<ReadableStreamBYOBReadResult<ReadableStreamBYOBView>>();
    const descriptor = new PullIntoDescriptor(
      transferred,
      bufferByteLength,
      byteOffset,
      byteLength,
      minimumElements * elementSize,
      elementSize,
      kind,
      "byob",
      null,
      result,
    );
    if (closed) {
      this.#commitDescriptor(descriptor, true);
      return result.promise;
    }
    if (this.#queueTotalSize > 0 && this.#fillFromQueue(descriptor)) {
      this.#commitDescriptor(descriptor, false);
      this.#handleQueueDrain();
      return result.promise;
    }
    if (
      this.#closeRequested &&
      this.#queueTotalSize === 0 &&
      descriptor.bytesFilled % descriptor.elementSize !== 0
    ) {
      const error = new TypeError("Byte stream closed with an incomplete typed-array element");
      result.reject(error);
      this.stream.fail(error);
      return result.promise;
    }
    this.#pullIntos.enqueue(descriptor);
    this.#maybePull();
    return result.promise;
  }

  enqueue(chunk: ReadableStreamBYOBView): void {
    if (!this.canCloseOrEnqueue) {
      throw new TypeError("Byte stream is not writable");
    }
    const byteOffset = chunk.byteOffset;
    const byteLength = chunk.byteLength;
    const transferred = chunk.buffer.transfer();

    const pendingPullInto = this.#pullIntos.peek();
    if (pendingPullInto !== undefined) {
      this.#invalidateBYOBRequest();
      pendingPullInto.buffer = pendingPullInto.buffer.transfer();
      if (pendingPullInto.readerKind === "none") {
        this.#pullIntos.dequeue();
        if (pendingPullInto.bytesFilled > 0) {
          const detachedBytes = pendingPullInto.buffer.slice(
            pendingPullInto.byteOffset,
            pendingPullInto.byteOffset + pendingPullInto.bytesFilled,
          );
          this.#enqueueChunk(detachedBytes, 0, detachedBytes.byteLength);
          this.#processDefaultReads();
        }
        const currentPullInto = this.#pullIntos.peek();
        if (
          this.#queueTotalSize === 0 &&
          currentPullInto?.readerKind === "default" &&
          currentPullInto.bytesFilled === 0
        ) {
          this.#pullIntos.dequeue();
          const result = currentPullInto.defaultResult;
          currentPullInto.defaultResult = null;
          result?.resolve({
            done: false,
            value: new Uint8Array(transferred, byteOffset, byteLength),
          });
          this.#maybePull();
          return;
        }
      } else if (pendingPullInto.readerKind === "default" && pendingPullInto.bytesFilled === 0) {
        this.#pullIntos.dequeue();
        const result = pendingPullInto.defaultResult;
        pendingPullInto.defaultResult = null;
        result?.resolve({
          done: false,
          value: new Uint8Array(transferred, byteOffset, byteLength),
        });
        this.#maybePull();
        return;
      }
    }

    const defaultRead = this.#defaultReads.dequeue();
    if (defaultRead !== undefined && this.#pullIntos.empty) {
      defaultRead.resolve({
        done: false,
        value: new Uint8Array(transferred, byteOffset, byteLength),
      });
    } else {
      if (defaultRead !== undefined) this.#defaultReads.enqueue(defaultRead);
      this.#enqueueChunk(transferred, byteOffset, byteLength);
      this.#processPullIntos();
      this.#processDefaultReads();
    }
    this.#maybePull();
  }

  requestClose(): void {
    if (!this.canCloseOrEnqueue) {
      throw new TypeError("Byte stream cannot be closed twice");
    }
    this.#closeRequested = true;
    if (this.#queueTotalSize !== 0) return;
    const descriptor = this.#pullIntos.peek();
    if (descriptor !== undefined && descriptor.bytesFilled % descriptor.elementSize !== 0) {
      const error = new TypeError("Byte stream closed with an incomplete typed-array element");
      this.stream.fail(error);
      throw error;
    }
    this.#clearAlgorithms();
    this.stream.finishByteStream(false);
  }

  respond(bytesWritten: number): void {
    const descriptor = this.#pullIntos.peek();
    if (descriptor === undefined) {
      throw new TypeError("There is no pending BYOB request");
    }
    const state = this.stream[readableStreamStateName];
    if (state === "closed") {
      if (bytesWritten !== 0) {
        throw new TypeError("A closed byte stream only accepts a zero-byte response");
      }
    } else {
      if (state !== "readable" || bytesWritten === 0) {
        throw new TypeError("A readable byte stream requires a non-zero response");
      }
      if (descriptor.bytesFilled + bytesWritten > descriptor.byteLength) {
        throw new RangeError("bytesWritten exceeds the pending view");
      }
    }
    descriptor.buffer = descriptor.buffer.transfer();
    this.#invalidateBYOBRequest();
    this.#respondAfterTransfer(descriptor, bytesWritten, state === "closed");
  }

  respondWithNewView(view: ReadableStreamBYOBView): void {
    const descriptor = this.#pullIntos.peek();
    if (descriptor === undefined) {
      throw new TypeError("There is no pending BYOB request");
    }
    const closed = this.stream[readableStreamStateName] === "closed";
    if (closed ? view.byteLength !== 0 : view.byteLength === 0) {
      throw new TypeError("The replacement view has the wrong length for the stream state");
    }
    if (descriptor.byteOffset + descriptor.bytesFilled !== view.byteOffset) {
      throw new RangeError("The replacement view has the wrong byteOffset");
    }
    if (descriptor.bytesFilled + view.byteLength > descriptor.byteLength) {
      throw new RangeError("The replacement view exceeds the pending view");
    }
    if (view.buffer.byteLength !== descriptor.bufferByteLength) {
      throw new RangeError("The replacement view has a different backing length");
    }
    const byteLength = view.byteLength;
    descriptor.buffer = view.buffer.transfer();
    this.#invalidateBYOBRequest();
    this.#respondAfterTransfer(descriptor, byteLength, closed);
  }

  async cancel(reason: unknown): Promise<void> {
    const source = this.#source;
    const cancel = this.#cancelAlgorithm;
    this.#queue.reset();
    this.#queueTotalSize = 0;
    this.#invalidateBYOBRequest();
    this.#clearAlgorithms();
    if (source !== null && cancel !== undefined) {
      await cancel.call(source, reason);
    }
  }

  releaseDefault(error: unknown): void {
    while (!this.#defaultReads.empty) this.#defaultReads.dequeue()?.reject(error);
    this.#releasePullIntos("default", error);
  }

  releaseBYOB(error: unknown): void {
    this.#releasePullIntos("byob", error);
  }

  finish(settleReads: boolean): void {
    this.#clearAlgorithms();
    while (!this.#defaultReads.empty) {
      this.#defaultReads.dequeue()?.resolve({ done: true, value: undefined });
    }

    const retained = new Fifo<PullIntoDescriptor>();
    while (!this.#pullIntos.empty) {
      const descriptor = this.#pullIntos.dequeue();
      if (descriptor === undefined) break;
      if (descriptor.readerKind === "default") {
        descriptor.defaultResult?.resolve({ done: true, value: undefined });
        descriptor.defaultResult = null;
        if (!settleReads) retained.enqueue(descriptor);
      } else if (settleReads && descriptor.readerKind === "byob") {
        descriptor.byobResult?.resolve({ done: true, value: undefined });
        descriptor.byobResult = null;
      } else {
        retained.enqueue(descriptor);
      }
    }
    while (!retained.empty) {
      const descriptor = retained.dequeue();
      if (descriptor !== undefined) this.#pullIntos.enqueue(descriptor);
    }
  }

  fail(error: unknown): void {
    this.#clearAlgorithms();
    this.#queue.reset();
    this.#queueTotalSize = 0;
    this.#invalidateBYOBRequest();
    while (!this.#defaultReads.empty) this.#defaultReads.dequeue()?.reject(error);
    while (!this.#pullIntos.empty) {
      const descriptor = this.#pullIntos.dequeue();
      descriptor?.defaultResult?.reject(error);
      descriptor?.byobResult?.reject(error);
    }
  }

  #respondAfterTransfer(
    descriptor: PullIntoDescriptor,
    bytesWritten: number,
    closed: boolean,
  ): void {
    if (closed) {
      while (!this.#pullIntos.empty) {
        const pending = this.#pullIntos.dequeue();
        if (pending !== undefined) this.#commitDescriptor(pending, true);
      }
      return;
    }

    descriptor.bytesFilled += bytesWritten;
    if (descriptor.readerKind === "none") {
      this.#pullIntos.dequeue();
      if (descriptor.bytesFilled > 0) {
        const copy = descriptor.buffer.slice(
          descriptor.byteOffset,
          descriptor.byteOffset + descriptor.bytesFilled,
        );
        this.#enqueueChunk(copy, 0, copy.byteLength);
      }
      this.#processPullIntos();
      this.#processDefaultReads();
      this.#maybePull();
      return;
    }
    if (descriptor.bytesFilled < descriptor.minimumFillBytes) {
      this.#maybePull();
      return;
    }

    this.#pullIntos.dequeue();
    const remainderSize = descriptor.bytesFilled % descriptor.elementSize;
    if (remainderSize !== 0) {
      const end = descriptor.byteOffset + descriptor.bytesFilled;
      const remainder = descriptor.buffer.slice(end - remainderSize, end);
      this.#enqueueChunk(remainder, 0, remainderSize);
      descriptor.bytesFilled -= remainderSize;
    }
    this.#commitDescriptor(descriptor, false);
    this.#processPullIntos();
    this.#processDefaultReads();
    this.#maybePull();
  }

  #fillFromQueue(descriptor: PullIntoDescriptor): boolean {
    const maximum = Math.min(this.#queueTotalSize, descriptor.byteLength - descriptor.bytesFilled);
    const maximumFilled = descriptor.bytesFilled + maximum;
    const alignedFilled = maximumFilled - (maximumFilled % descriptor.elementSize);
    let remaining = maximum;
    let ready = false;
    if (alignedFilled >= descriptor.minimumFillBytes) {
      remaining = alignedFilled - descriptor.bytesFilled;
      ready = true;
    }
    while (remaining > 0) {
      const entry = this.#queue.peek();
      if (entry === undefined) break;
      const count = Math.min(remaining, entry.byteLength);
      new Uint8Array(descriptor.buffer, descriptor.byteOffset + descriptor.bytesFilled, count).set(
        new Uint8Array(entry.buffer, entry.byteOffset, count),
      );
      descriptor.bytesFilled += count;
      this.#queueTotalSize -= count;
      remaining -= count;
      if (count === entry.byteLength) {
        this.#queue.dequeue();
      } else {
        entry.byteOffset += count;
        entry.byteLength -= count;
      }
    }
    return ready;
  }

  #processPullIntos(): void {
    const ready = new Fifo<PullIntoDescriptor>();
    while (this.#queueTotalSize > 0) {
      const descriptor = this.#pullIntos.peek();
      if (descriptor === undefined || !this.#fillFromQueue(descriptor)) break;
      this.#pullIntos.dequeue();
      this.#invalidateBYOBRequest();
      ready.enqueue(descriptor);
    }
    this.#handleQueueDrain();
    const done = this.stream[readableStreamStateName] === "closed";
    while (!ready.empty) {
      const descriptor = ready.dequeue();
      if (descriptor !== undefined) this.#commitDescriptor(descriptor, done);
    }
  }

  #processDefaultReads(): void {
    while (this.#queueTotalSize > 0 && !this.#defaultReads.empty) {
      this.#defaultReads.dequeue()?.resolve({ done: false, value: this.#dequeueChunk() });
    }
  }

  #commitDescriptor(descriptor: PullIntoDescriptor, done: boolean): void {
    const transferred = descriptor.buffer.transfer();
    const byteLength = descriptor.bytesFilled;
    const view = createByteView(
      descriptor.viewKind,
      transferred,
      descriptor.byteOffset,
      byteLength,
    );
    descriptor.defaultResult?.resolve(
      done && byteLength === 0
        ? { done: true, value: undefined }
        : { done: false, value: new Uint8Array(transferred, descriptor.byteOffset, byteLength) },
    );
    descriptor.byobResult?.resolve({ done, value: view });
    descriptor.defaultResult = null;
    descriptor.byobResult = null;
  }

  #dequeueChunk(): Uint8Array {
    const entry = this.#queue.dequeue();
    if (entry === undefined) throw new TypeError("Byte stream queue is empty");
    this.#queueTotalSize -= entry.byteLength;
    const chunk = new Uint8Array(entry.buffer, entry.byteOffset, entry.byteLength);
    this.#handleQueueDrain();
    return chunk;
  }

  #enqueueChunk(buffer: ArrayBuffer, byteOffset: number, byteLength: number): void {
    this.#queue.enqueue(new ByteQueueEntry(buffer, byteOffset, byteLength));
    this.#queueTotalSize += byteLength;
  }

  #handleQueueDrain(): void {
    if (this.#queueTotalSize !== 0) return;
    if (this.#closeRequested) {
      this.#clearAlgorithms();
      this.stream.finishByteStream(false);
    } else {
      this.#maybePull();
    }
  }

  #releasePullIntos(readerKind: PullIntoReaderKind, error: unknown): void {
    let first: PullIntoDescriptor | null = null;
    while (!this.#pullIntos.empty) {
      const descriptor = this.#pullIntos.dequeue();
      if (descriptor === undefined) break;
      if (descriptor.readerKind === readerKind) {
        descriptor.defaultResult?.reject(error);
        descriptor.byobResult?.reject(error);
        descriptor.defaultResult = null;
        descriptor.byobResult = null;
      }
      if (first === null) first = descriptor;
    }
    if (first !== null) {
      first.readerKind = "none";
      this.#pullIntos.enqueue(first);
    }
  }

  #invalidateBYOBRequest(): void {
    this.#currentBYOBRequest?.invalidate();
    this.#currentBYOBRequest = null;
  }

  async #observeStart(result: void | PromiseLike<void>): Promise<void> {
    try {
      await result;
      this.#started = true;
      this.#maybePull();
    } catch (error) {
      this.stream.fail(error);
    }
  }

  #maybePull(): void {
    if (!this.#started || !this.canCloseOrEnqueue) return;
    if (
      this.#defaultReads.empty &&
      this.#pullIntos.empty &&
      this.#highWaterMark <= this.#queueTotalSize
    ) {
      return;
    }
    if (this.#pulling) {
      this.#pullAgain = true;
      return;
    }
    const source = this.#source;
    const pull = this.#pullAlgorithm;
    if (source === null || pull === undefined) return;
    this.#pulling = true;
    let result: void | PromiseLike<void>;
    try {
      result = pull.call(source, this.#controller);
    } catch (error) {
      this.#pulling = false;
      this.stream.fail(error);
      return;
    }
    this.#observePull(result);
  }

  async #observePull(result: void | PromiseLike<void>): Promise<void> {
    try {
      await result;
      this.#pulling = false;
      if (this.#pullAgain) {
        this.#pullAgain = false;
        this.#maybePull();
      }
    } catch (error) {
      this.#pulling = false;
      this.stream.fail(error);
    }
  }

  #clearAlgorithms(): void {
    this.#source = null;
    this.#pullAlgorithm = undefined;
    this.#cancelAlgorithm = undefined;
  }
}

/** @internal */
export function readableStreamCanCloseOrEnqueue<T>(stream: ReadableStream<T>): boolean {
  return stream.canCloseOrEnqueue;
}

/** @internal */
export function readableStreamClose<T>(stream: ReadableStream<T>): void {
  if (stream[readableStreamStateName] === "readable") {
    stream.requestClose();
  }
}

/** @internal */
export function readableStreamDesiredSize<T>(stream: ReadableStream<T>): number | null {
  return stream.desiredSize;
}

/** @internal */
export function readableStreamEnqueue<T>(stream: ReadableStream<T>, chunk: T): void {
  stream.enqueue(chunk);
}

/** @internal */
export function readableStreamError<T>(stream: ReadableStream<T>, reason: unknown): void {
  stream.fail(reason);
}

/** @internal */
export function readableStreamIsErrored<T>(stream: ReadableStream<T>): boolean {
  return stream[readableStreamStateName] === "errored";
}

/** @internal */
export function readableStreamStoredError<T>(stream: ReadableStream<T>): unknown {
  return stream[readableStreamStoredErrorValue];
}

export class ReadableStreamDefaultReader<T> {
  #stream: ReadableStream<T> | null;
  #closedCapability = Promise.withResolvers<void>();
  #closedState: "pending" | "fulfilled" | "rejected" = "pending";

  get closed(): Promise<void> {
    return this.#closedCapability.promise;
  }

  constructor(stream: ReadableStream<T>) {
    if (!(stream instanceof ReadableStream)) {
      throw new TypeError("stream must be a ReadableStream");
    }
    this.#stream = stream;
    ignoreRejection(this.closed);
    stream.attach(this);
  }

  /** @internal */ released(error: unknown): void {
    if (this.#closedState !== "pending") {
      this.#closedCapability = Promise.withResolvers<void>();
      this.#closedState = "pending";
      ignoreRejection(this.closed);
    }
    this.#closedState = "rejected";
    this.#closedCapability.reject(error);
  }

  read(): Promise<ReadResult<T>> {
    if (this.#stream === null) {
      return Promise.reject(new TypeError("Reader has been released"));
    }
    return this.#stream.read(this);
  }

  cancel(reason: unknown = undefined): Promise<void> {
    if (this.#stream === null) {
      return Promise.reject(new TypeError("Reader has been released"));
    }
    return this.#stream.cancelInternal(reason);
  }

  releaseLock(): void {
    this.#stream?.release(this);
    this.#stream = null;
  }

  /** @internal */ finish(): void {
    if (this.#closedState !== "pending") {
      return;
    }
    this.#closedState = "fulfilled";
    this.#closedCapability.resolve();
  }

  /** @internal */ fail(error: unknown): void {
    if (this.#closedState !== "pending") {
      return;
    }
    this.#closedState = "rejected";
    this.#closedCapability.reject(error);
  }


  // Web IDL surface shape; see core/interface-tag.ts for the rule and why it is
  // written inline rather than through a helper.
  static {
    Object.defineProperty(this.prototype, Symbol.toStringTag, {
      value: "ReadableStreamDefaultReader",
      writable: false,
      enumerable: false,
      configurable: true,
    });
  }
}

function startPipe<T>(
  source: ReadableStream<T>,
  destination: WritableStream<T>,
  options: ConvertedPipeOptions,
): Promise<void> {
  const reader = new ReadableStreamDefaultReader(source);
  const writer = acquireWritableStreamDefaultWriter(destination);
  source.markDisturbed();
  const pipe = new PipeState(source, destination, reader, writer, options);
  pipe.start();
  return pipe.promise;
}

type PipeAction = () => Promise<void>;

class PipeState<T> {
  readonly #result = Promise.withResolvers<void>();
  readonly #source: ReadableStream<T>;
  readonly #destination: WritableStream<T>;
  readonly #reader: ReadableStreamDefaultReader<T>;
  readonly #writer: WritableStreamDefaultWriter<T>;
  readonly #options: ConvertedPipeOptions;
  #shuttingDown = false;
  #pendingWrites = 0;
  #writeFailed = false;
  #writeFailure: unknown;
  #writeDrain: PromiseWithResolvers<void> | null = null;
  #unsubscribe: (() => void) | null = null;
  #reading = false;
  #sourceClosePending = false;

  constructor(
    source: ReadableStream<T>,
    destination: WritableStream<T>,
    reader: ReadableStreamDefaultReader<T>,
    writer: WritableStreamDefaultWriter<T>,
    options: ConvertedPipeOptions,
  ) {
    this.#source = source;
    this.#destination = destination;
    this.#reader = reader;
    this.#writer = writer;
    this.#options = options;
  }

  get promise(): Promise<void> {
    return this.#result.promise;
  }

  start(): void {
    const signal = this.#options.signal;
    if (signal !== undefined && signal.aborted) {
      this.#abort(signal.reason);
      return;
    }
    if (signal !== undefined) {
      this.#unsubscribe = signal.subscribe(() => this.#abort(signal.reason));
    }

    this.#pump();
    this.#watchSource();
    this.#watchDestination();

    if (this.#source[readableStreamStateName] === "errored") {
      this.#sourceErrored(this.#source[readableStreamStoredErrorValue]);
    } else if (writableStreamIsErrored(this.#destination)) {
      this.#destinationErrored(writableStreamStoredError(this.#destination));
    } else if (this.#source[readableStreamStateName] === "closed") {
      this.#sourceClosed();
    } else if (writableStreamIsClosingOrClosed(this.#destination)) {
      this.#destinationClosed();
    }
  }

  async #pump(): Promise<void> {
    while (!this.#shuttingDown) {
      try {
        await writableStreamDefaultWriterReady(this.#writer);
      } catch {
        return;
      }
      if (this.#shuttingDown) return;
      if (this.#source[readableStreamStateName] === "closed") {
        this.#sourceClosed();
        return;
      }
      if (this.#source[readableStreamStateName] === "errored") {
        this.#sourceErrored(this.#source[readableStreamStoredErrorValue]);
        return;
      }

      let result: ReadResult<T>;
      this.#reading = true;
      try {
        result = await this.#source.read(this.#reader);
      } catch (error) {
        this.#reading = false;
        this.#sourceErrored(error);
        return;
      }
      this.#reading = false;
      if (this.#shuttingDown) return;
      if (result.done) {
        this.#sourceClosePending = false;
        this.#sourceClosed();
        return;
      }
      this.#trackWrite(writableStreamDefaultWriterWrite(this.#writer, result.value));
      if (this.#sourceClosePending) {
        this.#sourceClosePending = false;
        this.#sourceClosed();
      }
    }
  }

  async #watchSource(): Promise<void> {
    try {
      await this.#reader.closed;
      this.#sourceClosed();
    } catch (error) {
      this.#sourceErrored(error);
    }
  }

  async #watchDestination(): Promise<void> {
    try {
      await writableStreamDefaultWriterClosed(this.#writer);
      this.#destinationClosed();
    } catch (error) {
      this.#destinationErrored(error);
    }
  }

  #trackWrite(write: Promise<void>): void {
    this.#pendingWrites++;
    this.#observeWrite(write);
  }

  async #observeWrite(write: Promise<void>): Promise<void> {
    try {
      await write;
    } catch (error) {
      if (!this.#writeFailed) {
        this.#writeFailed = true;
        this.#writeFailure = error;
      }
    }
    this.#pendingWrites--;
    if (this.#pendingWrites !== 0 || this.#writeDrain === null) return;
    const drain = this.#writeDrain;
    this.#writeDrain = null;
    if (this.#writeFailed) drain.reject(this.#writeFailure);
    else drain.resolve();
  }

  #waitForPendingWrites(): Promise<void> {
    if (this.#pendingWrites === 0) {
      return this.#writeFailed ? Promise.reject(this.#writeFailure) : Promise.resolve();
    }
    const drain = Promise.withResolvers<void>();
    this.#writeDrain = drain;
    return drain.promise;
  }

  #sourceErrored(error: unknown): void {
    if (this.#options.preventAbort) {
      this.#shutdown(true, error);
      return;
    }
    this.#shutdown(true, error, () => writableStreamDefaultWriterAbort(this.#writer, error));
  }

  #destinationErrored(error: unknown): void {
    if (this.#options.preventCancel) {
      this.#shutdown(true, error);
      return;
    }
    this.#shutdown(true, error, () => this.#source.cancelInternal(error));
  }

  #sourceClosed(): void {
    if (this.#reading) {
      this.#sourceClosePending = true;
      return;
    }
    if (this.#options.preventClose) {
      this.#shutdown(false, undefined);
      return;
    }
    this.#shutdown(false, undefined, () =>
      writableStreamDefaultWriterCloseWithErrorPropagation(this.#writer),
    );
  }

  #destinationClosed(): void {
    const error = new TypeError("Destination WritableStream is closed");
    if (this.#options.preventCancel) {
      this.#shutdown(true, error);
      return;
    }
    this.#shutdown(true, error, () => this.#source.cancelInternal(error));
  }

  #abort(reason: unknown): void {
    const actions: PipeAction[] = [];
    if (!this.#options.preventAbort && writableStreamIsWritable(this.#destination)) {
      actions.push(() => writableStreamDefaultWriterAbort(this.#writer, reason));
    }
    if (!this.#options.preventCancel && this.#source[readableStreamStateName] === "readable") {
      actions.push(() => this.#source.cancelInternal(reason));
    }
    this.#shutdown(true, reason, () => runPipeActions(actions));
  }

  #shutdown(rejected: boolean, reason: unknown, action?: PipeAction): void {
    if (this.#shuttingDown) return;
    this.#shuttingDown = true;
    this.#finishShutdown(rejected, reason, action);
  }

  async #finishShutdown(rejected: boolean, reason: unknown, action?: PipeAction): Promise<void> {
    try {
      if (writableStreamCanAcceptWrites(this.#destination)) {
        await this.#waitForPendingWrites();
      }
      if (action !== undefined) await action();
      this.#finalize(rejected, reason);
    } catch (error) {
      this.#finalize(true, error);
    }
  }

  #finalize(rejected: boolean, reason: unknown): void {
    this.#unsubscribe?.();
    this.#unsubscribe = null;
    this.#source.release(this.#reader);
    writableStreamDefaultWriterRelease(this.#writer);
    if (rejected) this.#result.reject(reason);
    else this.#result.resolve();
  }
}

async function runPipeActions(actions: PipeAction[]): Promise<void> {
  const promises: Promise<void>[] = [];
  for (const action of actions) promises.push(action());
  await Promise.all(promises);
}

export interface TeeOptions<T> {
  clone?: (chunk: T) => T;
  size?: (chunk: T) => number;
  /** Infinity is standards-shaped. A finite cap is an explicit NTS safety policy. */
  maxBufferedSize?: number;
}

const defaultTeeOptions = {
  clone: undefined,
  maxBufferedSize: undefined,
  size: undefined,
};

class ByteTeeBranch<T> {
  controller: ReadableByteStreamController | undefined;
  canceled = false;
  reason: unknown;
  readonly stream: ReadableStream<T>;

  constructor(owner: ByteTeeState<T>, index: number) {
    this.stream = new ReadableStream<T>({
      type: "bytes",
      start: (controller) => {
        this.controller = controller;
      },
      pull: () => owner.pull(index),
      cancel: (reason) => owner.cancel(index, reason),
    });
  }

  get request(): ReadableStreamBYOBRequest | null {
    return this.controller?.byobRequest ?? null;
  }

  close(view?: ReadableStreamBYOBView): void {
    if (this.canceled) return;
    const controller = this.controller;
    controller?.close();
    const request = controller?.byobRequest;
    if (request === null || request === undefined) return;
    if (view === undefined) request.respond(0);
    else request.respondWithNewView(view);
  }

  fail(error: unknown): void {
    if (!this.canceled) this.controller?.error(error);
  }

  enqueue(bytes: Uint8Array<ArrayBuffer>): void {
    if (!this.canceled) this.controller?.enqueue(bytes);
  }
}

class ByteTeeState<T> {
  readonly branches: [ByteTeeBranch<T>, ByteTeeBranch<T>];
  readonly #source: ReadableStream<T>;
  readonly #clone: ((chunk: T) => T) | undefined;
  readonly #size: ((chunk: T) => number) | undefined;
  readonly #limit: number;
  readonly #canceled = Promise.withResolvers<void>();
  #reader: ReadableStreamDefaultReader<T> | ReadableStreamBYOBReader;
  #reading = false;
  #readAgainFirst = false;
  #readAgainSecond = false;
  #done = false;

  constructor(stream: ReadableStream<T>, options: TeeOptions<T>) {
    this.#source = stream;
    this.#clone = options.clone;
    this.#size = options.size;
    this.#limit = options.maxBufferedSize ?? Infinity;
    if (Number.isNaN(this.#limit) || this.#limit < 0) {
      throw new RangeError("Invalid clone buffer limit");
    }
    this.#reader = new ReadableStreamDefaultReader(stream);
    this.branches = [new ByteTeeBranch(this, 0), new ByteTeeBranch(this, 1)];
    ignoreRejection(this.#canceled.promise);
    this.#observeReader(this.#reader);
  }

  pull(index: number): Promise<void> {
    if (this.#done) return Promise.resolve();
    if (this.#reading) {
      if (index === 0) this.#readAgainFirst = true;
      else this.#readAgainSecond = true;
      return Promise.resolve();
    }
    this.#reading = true;
    const request = this.branches[index]?.request;
    const view = request?.view;
    if (request === null || request === undefined || view === null || view === undefined) {
      this.#readDefault();
    } else {
      this.#readInto(view, index);
    }
    return Promise.resolve();
  }

  cancel(index: number, reason: unknown): Promise<void> {
    const branch = this.branches[index];
    if (branch !== undefined) {
      branch.canceled = true;
      branch.reason = reason;
    }
    if (this.branches[0].canceled && this.branches[1].canceled && !this.#done) {
      this.#done = true;
      const cancellation = this.#reader.cancel([this.branches[0].reason, this.branches[1].reason]);
      this.#finishCancellation(cancellation);
    }
    return this.#canceled.promise;
  }

  async #readDefault(): Promise<void> {
    const reader = this.#defaultReader();
    let result: ReadResult<T>;
    try {
      result = await reader.read();
    } catch (error) {
      if (reader === this.#reader) this.#sourceErrored(error);
      return;
    }
    if (reader !== this.#reader || this.#done) return;
    if (result.done) {
      this.#sourceClosed();
      return;
    }
    if (!(result.value instanceof Uint8Array) || !(result.value.buffer instanceof ArrayBuffer)) {
      this.#failTee(new TypeError("A byte stream produced a non-byte chunk"));
      return;
    }
    const bytes = new Uint8Array(
      result.value.buffer,
      result.value.byteOffset,
      result.value.byteLength,
    );
    this.#forwardDefault(result.value, bytes);
  }

  async #readInto(view: ReadableStreamBYOBView, index: number): Promise<void> {
    const reader = this.#byobReader();
    let result: ReadableStreamBYOBReadResult<ReadableStreamBYOBView>;
    try {
      result = await reader.read(view);
    } catch (error) {
      if (reader === this.#reader) this.#sourceErrored(error);
      return;
    }
    if (reader !== this.#reader || this.#done) return;
    if (result.done) {
      this.#sourceClosed(index, result.value);
      return;
    }
    this.#forwardBYOB(result.value, index);
  }

  #defaultReader(): ReadableStreamDefaultReader<T> {
    const reader = this.#reader;
    if (reader instanceof ReadableStreamDefaultReader) return reader;
    reader.releaseLock();
    const replacement = new ReadableStreamDefaultReader(this.#source);
    this.#reader = replacement;
    this.#observeReader(replacement);
    return replacement;
  }

  #byobReader(): ReadableStreamBYOBReader {
    const reader = this.#reader;
    if (reader instanceof ReadableStreamBYOBReader) return reader;
    reader.releaseLock();
    const replacement = new ReadableStreamBYOBReader(this.#source);
    this.#reader = replacement;
    this.#observeReader(replacement);
    return replacement;
  }

  async #observeReader(
    reader: ReadableStreamDefaultReader<T> | ReadableStreamBYOBReader,
  ): Promise<void> {
    try {
      await reader.closed;
    } catch (error) {
      if (reader === this.#reader) this.#sourceErrored(error);
    }
  }

  #forwardDefault(value: T, bytes: Uint8Array<ArrayBuffer>): void {
    this.#resetReadAgain();
    try {
      const size = this.#size === undefined ? bytes.byteLength : this.#size(value);
      this.#checkSize(size);
      let second = bytes;
      if (!this.branches[0].canceled && !this.branches[1].canceled) {
        const clone = this.#clone;
        if (clone === undefined) {
          second = bytes.slice();
        } else {
          const cloned = clone(value);
          if (!(cloned instanceof Uint8Array) || !(cloned.buffer instanceof ArrayBuffer)) {
            throw new TypeError("A byte-stream tee clone must be a Uint8Array");
          }
          second = new Uint8Array(cloned.buffer, cloned.byteOffset, cloned.byteLength);
        }
      }
      this.branches[0].enqueue(bytes);
      this.branches[1].enqueue(second);
      this.#finishRead();
    } catch (error) {
      this.#failTee(error);
    }
  }

  #forwardBYOB(view: ReadableStreamBYOBView, index: number): void {
    this.#resetReadAgain();
    try {
      this.#checkSize(view.byteLength);
      const bytes = new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
      const clone = bytes.slice();
      const byobBranch = this.branches[index];
      const otherBranch = this.branches[index === 0 ? 1 : 0];
      if (byobBranch !== undefined && !byobBranch.canceled) {
        byobBranch.request?.respondWithNewView(view);
      }
      otherBranch?.enqueue(clone);
      this.#finishRead();
    } catch (error) {
      this.#failTee(error);
    }
  }

  #checkSize(size: number): void {
    if (!Number.isFinite(size) || size < 0) {
      throw new RangeError("Invalid chunk size");
    }
    for (const branch of this.branches) {
      if (!branch.canceled && branch.stream.queuedSize + size > this.#limit) {
        throw new LimitError("Clone backlog exceeded configured limit");
      }
    }
  }

  #sourceClosed(index?: number, view?: ReadableStreamBYOBView): void {
    if (this.#done) return;
    this.#done = true;
    this.#reading = false;
    if (index === undefined) {
      this.branches[0].close();
      this.branches[1].close();
    } else {
      this.branches[index]?.close(view);
      this.branches[index === 0 ? 1 : 0]?.close();
    }
    this.#canceled.resolve();
  }

  #sourceErrored(error: unknown): void {
    if (this.#done) return;
    this.#done = true;
    this.#reading = false;
    this.branches[0].fail(error);
    this.branches[1].fail(error);
    this.#canceled.resolve();
  }

  #failTee(error: unknown): void {
    if (this.#done) return;
    this.#done = true;
    this.#reading = false;
    this.branches[0].fail(error);
    this.branches[1].fail(error);
    this.#finishCancellation(this.#reader.cancel(error));
  }

  async #finishCancellation(cancellation: Promise<void>): Promise<void> {
    try {
      await cancellation;
      this.#canceled.resolve();
    } catch (error) {
      this.#canceled.reject(error);
    }
  }

  #resetReadAgain(): void {
    this.#readAgainFirst = false;
    this.#readAgainSecond = false;
  }

  #finishRead(): void {
    this.#reading = false;
    if (this.#done) return;
    if (this.#readAgainFirst) this.pull(0);
    else if (this.#readAgainSecond) this.pull(1);
  }
}

class TeeBranch<T> {
  controller: ReadableStreamDefaultController<T> | undefined;
  canceled = false;
  reason: unknown;
  readonly stream: ReadableStream<T>;

  constructor(owner: TeeState<T>, index: number, size: (chunk: T) => number) {
    this.stream = new ReadableStream<T>(
      {
        start: (controller) => {
          this.controller = controller;
        },
        pull: () => owner.pull(),
        cancel: (reason) => owner.cancel(index, reason),
        type: undefined,
      },
      { highWaterMark: 1, size },
    );
  }

  close(): void {
    if (!this.canceled) {
      this.controller?.close();
    }
  }

  fail(error: unknown): void {
    if (!this.canceled) {
      this.controller?.error(error);
    }
  }

  enqueue(value: T): void {
    if (!this.canceled) {
      this.controller?.enqueue(value);
    }
  }
}

class TeeState<T> {
  readonly branches: [TeeBranch<T>, TeeBranch<T>];
  // Tee permanently owns this reader. Releasing it after a terminal transition
  // would make the original stream observably unlocked, unlike the Streams API.
  private readonly reader: ReadableStreamDefaultReader<T>;
  private readonly clone: (chunk: T) => T;
  private readonly size: (chunk: T) => number;
  private readonly limit: number;
  private readonly canceled = Promise.withResolvers<void>();
  private reading: Promise<void> | null = null;
  private readAgain = false;
  private sourceClosePending = false;
  private sourceErrorPending = false;
  private sourceError: unknown;
  private done = false;

  constructor(stream: ReadableStream<T>, options: TeeOptions<T>) {
    this.clone = options.clone ?? identity;
    this.size = options.size ?? countChunk;
    this.limit = options.maxBufferedSize ?? Infinity;
    if (Number.isNaN(this.limit) || this.limit < 0) {
      throw new RangeError("Invalid clone buffer limit");
    }
    this.reader = new ReadableStreamDefaultReader(stream);
    this.branches = [new TeeBranch(this, 0, this.size), new TeeBranch(this, 1, this.size)];
    ignoreRejection(this.canceled.promise);
    this.observeSourceState();
  }

  private async observeSourceState(): Promise<void> {
    try {
      await this.reader.closed;
      this.sourceClosed();
    } catch (error) {
      this.sourceErrored(error);
    }
  }

  pull(): Promise<void> {
    if (this.done) {
      return Promise.resolve();
    }
    if (this.reading !== null) {
      this.readAgain = true;
      return this.reading;
    }
    const reading = this.readOne();
    this.reading = reading;
    this.finishReading(reading);
    return reading;
  }

  private async finishReading(reading: Promise<void>): Promise<void> {
    let failed = false;
    let readError: unknown;
    try {
      await reading;
    } catch (error) {
      failed = true;
      readError = error;
    }
    if (this.reading !== reading) {
      return;
    }
    this.reading = null;
    if (this.done) {
      return;
    }
    if (failed) {
      this.sourceErrored(readError);
      return;
    }
    this.flushPendingSourceState();
    if (this.done) {
      return;
    }
    if (this.readAgain) {
      this.readAgain = false;
      this.pull();
    }
  }

  private async readOne(): Promise<void> {
    let result: ReadResult<T>;
    try {
      result = await this.reader.read();
    } catch (error) {
      this.sourceErrored(error);
      this.flushPendingSourceState();
      return;
    }

    try {
      if (this.done) {
        return;
      }
      if (result.done) {
        this.sourceClosed();
        this.flushPendingSourceState();
        return;
      }
      const sizeOf = this.size;
      const size = sizeOf(result.value);
      if (!Number.isFinite(size) || size < 0) {
        throw new RangeError("Invalid chunk size");
      }
      for (const branch of this.branches) {
        if (!branch.canceled && branch.stream.queuedSize + size > this.limit) {
          throw new LimitError("Clone backlog exceeded configured limit");
        }
      }
      const first = this.branches[0];
      const second = this.branches[1];
      // Clone before handing either branch a mutable chunk.
      const clone = this.clone;
      const secondValue = second.canceled ? result.value : clone(result.value);
      first.enqueue(result.value);
      second.enqueue(secondValue);
      this.flushPendingSourceState();
    } catch (error) {
      if (!this.done) {
        this.failTee(error);
      }
    }
  }

  cancel(index: number, reason: unknown): Promise<void> {
    const branch = this.branches[index];
    if (branch !== undefined) {
      branch.canceled = true;
      branch.reason = reason;
    }
    if (this.branches[0].canceled && this.branches[1].canceled && !this.done) {
      this.retire();
      const cancellation = this.reader.cancel([this.branches[0].reason, this.branches[1].reason]);
      this.finishCancellation(cancellation);
    }
    return this.canceled.promise;
  }

  private sourceClosed(): void {
    if (this.done) {
      return;
    }
    if (this.reading !== null) {
      this.sourceClosePending = true;
      return;
    }
    this.finishSourceClose();
  }

  private finishSourceClose(): void {
    this.retire();
    for (const branch of this.branches) {
      branch.close();
    }
    this.canceled.resolve();
  }

  private sourceErrored(error: unknown): void {
    if (this.done) {
      return;
    }
    if (this.reading !== null) {
      this.sourceErrorPending = true;
      this.sourceError = error;
      return;
    }
    this.finishSourceError(error);
  }

  private finishSourceError(error: unknown): void {
    this.retire();
    for (const branch of this.branches) {
      branch.fail(error);
    }
    // A branch canceled before the source failed has fulfilled its cancellation
    // contract; the source error is observed by the branch that remained active.
    this.canceled.resolve();
  }

  private flushPendingSourceState(): void {
    if (this.done) {
      return;
    }
    if (this.sourceErrorPending) {
      const error = this.sourceError;
      this.sourceErrorPending = false;
      this.sourceError = undefined;
      this.finishSourceError(error);
      return;
    }
    if (this.sourceClosePending) {
      this.sourceClosePending = false;
      this.finishSourceClose();
    }
  }

  private failTee(error: unknown): void {
    this.retire();
    for (const branch of this.branches) {
      branch.fail(error);
    }
    const cancellation = this.reader.cancel(error);
    this.finishCancellation(cancellation);
  }

  private async finishCancellation(cancellation: Promise<void>): Promise<void> {
    try {
      await cancellation;
      this.canceled.resolve();
    } catch (error) {
      this.canceled.reject(error);
    }
  }

  private retire(): void {
    this.done = true;
    this.readAgain = false;
    this.sourceClosePending = false;
    this.sourceErrorPending = false;
    this.sourceError = undefined;
  }
}

export function tee<T>(
  stream: ReadableStream<T>,
  options: TeeOptions<T> = defaultTeeOptions,
): [ReadableStream<T>, ReadableStream<T>] {
  if (stream.byteStream) {
    const state = new ByteTeeState(stream, options);
    return [state.branches[0].stream, state.branches[1].stream];
  }
  const state = new TeeState(stream, options);
  return [state.branches[0].stream, state.branches[1].stream];
}

export function bytesStream(bytes: Uint8Array, chunkSize = 65536): ReadableStream<Uint8Array> {
  if (!Number.isSafeInteger(chunkSize) || chunkSize < 1) {
    throw new RangeError("Invalid byte chunk size");
  }
  let position = 0;
  return new ReadableStream<Uint8Array>(
    {
      type: "bytes",
      pull(controller) {
        if (position === bytes.length) {
          const request = controller.byobRequest;
          controller.close();
          request?.respond(0);
          return;
        }
        const request = controller.byobRequest;
        const view = request?.view;
        if (request !== null && request !== undefined && view !== null && view !== undefined) {
          const count = Math.min(view.byteLength, chunkSize, bytes.length - position);
          new Uint8Array(view.buffer, view.byteOffset, count).set(
            bytes.subarray(position, position + count),
          );
          position += count;
          request.respond(count);
          return;
        }
        const end = Math.min(position + chunkSize, bytes.length);
        controller.enqueue(bytes.slice(position, end));
        position = end;
      },
    },
    { highWaterMark: 0 },
  );
}

class ByteTransferSource<T> implements UnderlyingByteSource {
  readonly type = "bytes";
  readonly #source: ReadableStream<T>;
  #reader: ReadableStreamDefaultReader<T> | ReadableStreamBYOBReader;

  constructor(source: ReadableStream<T>) {
    this.#source = source;
    this.#reader = new ReadableStreamDefaultReader(source);
  }

  async pull(controller: ReadableByteStreamController): Promise<void> {
    const request = controller.byobRequest;
    const view = request?.view;
    if (request === null || request === undefined || view === null || view === undefined) {
      const result = await this.#defaultReader().read();
      if (result.done) {
        controller.close();
        return;
      }
      if (!(result.value instanceof Uint8Array) || !(result.value.buffer instanceof ArrayBuffer)) {
        throw new TypeError("A byte stream produced a non-byte chunk");
      }
      controller.enqueue(
        new Uint8Array(result.value.buffer, result.value.byteOffset, result.value.byteLength),
      );
      return;
    }

    const result = await this.#byobReader().read(view);
    if (result.done) {
      controller.close();
      if (result.value === undefined) request.respond(0);
      else request.respondWithNewView(result.value);
      return;
    }
    request.respondWithNewView(result.value);
  }

  async cancel(reason: unknown): Promise<void> {
    await this.#reader.cancel(reason);
  }

  #defaultReader(): ReadableStreamDefaultReader<T> {
    const reader = this.#reader;
    if (reader instanceof ReadableStreamDefaultReader) return reader;
    reader.releaseLock();
    const replacement = new ReadableStreamDefaultReader(this.#source);
    this.#reader = replacement;
    return replacement;
  }

  #byobReader(): ReadableStreamBYOBReader {
    const reader = this.#reader;
    if (reader instanceof ReadableStreamBYOBReader) return reader;
    reader.releaseLock();
    const replacement = new ReadableStreamBYOBReader(this.#source);
    this.#reader = replacement;
    return replacement;
  }
}

/**
 * The source becomes disturbed immediately and stays locked, matching Fetch body
 * transfer. The proxy stream owns its reader even after a terminal transition.
 */
export function transfer<T>(stream: ReadableStream<T>): ReadableStream<T> {
  if (stream.byteStream) {
    const source = new ByteTransferSource(stream);
    stream.markDisturbed();
    return new ReadableStream<T>(source, { highWaterMark: 0 });
  }
  const reader = stream.getReader();

  stream.markDisturbed();
  return new ReadableStream<T>(
    {
      async pull(controller) {
        const result = await reader.read();
        if (result.done) {
          controller.close();
        } else {
          controller.enqueue(result.value);
        }
      },
      async cancel(reason) {
        await reader.cancel(reason);
      },
    },
    { highWaterMark: 0 },
  );
}
