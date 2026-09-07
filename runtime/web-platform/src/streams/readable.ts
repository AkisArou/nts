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
  #source: UnderlyingSource<T> | null;
  readonly #controller: ReadableStreamDefaultController<T>;
  readonly #highWaterMark: number;
  #sizeOf: QueuingStrategySize<T> | undefined;
  #pullAlgorithm: UnderlyingSourcePullCallback<T> | undefined;
  #cancelAlgorithm: UnderlyingSourceCancelCallback<T> | undefined;
  readonly #queue = new QueueWithSizes<T>();
  readonly #pending = new Fifo<PromiseWithResolvers<ReadResult<T>>>();
  #currentReader: ReadableStreamDefaultReader<T> | null = null;
  #state: StreamState = "readable";
  #storedError: unknown;
  #closeRequested = false;
  #started = false;
  #pulling = false;
  #pullAgain = false;
  #isDisturbed = false;

  constructor(
    source: UnderlyingSource<T> | null = defaultReadableSource,
    strategy: QueuingStrategy<T> | null = defaultReadableStrategy,
  ) {
    this.#sizeOf = extractSizeAlgorithm(strategy);
    this.#highWaterMark = extractHighWaterMark(strategy, 1);
    requireDictionary(source, "Underlying source");
    if (source === null) {
      throw new TypeError("Underlying source must be an object");
    }

    const type: unknown = source.type;
    if (type !== undefined) {
      coerceToDOMString(type);
      throw new TypeError("ReadableStream source type is not supported");
    }
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
    return this.#queue.totalSize;
  }

  /** @internal */ get canCloseOrEnqueue(): boolean {
    return this.#state === "readable" && !this.#closeRequested;
  }

  /** @internal */ markDisturbed(): void {
    this.#isDisturbed = true;
  }

  getReader(
    options: ReadableStreamGetReaderOptions | null = defaultReaderOptions,
  ): ReadableStreamDefaultReader<T> {
    requireDictionary(options, "ReadableStream reader options");
    const mode = options?.mode;
    if (mode !== undefined) {
      coerceToDOMString(mode);
      throw new TypeError("ReadableStream does not support a BYOB reader yet");
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
    const source = this.#source;
    const cancelAlgorithm = this.#cancelAlgorithm;
    this.#queue.reset();
    this.#finish();
    if (source !== null && cancelAlgorithm !== undefined) {
      await cancelAlgorithm.call(source, reason);
    }
  }

  /** @internal */ read(reader: ReadableStreamDefaultReader<T>): Promise<ReadResult<T>> {
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
    this.#rejectPending(error);
    reader.released(error);
  }

  /** @internal */ enqueue(value: T): void {
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
    if (this.#state !== "readable" || this.#closeRequested) {
      throw new TypeError("Stream cannot be closed twice");
    }
    this.#closeRequested = true;
    if (this.#queue.empty) {
      this.#finish();
    }
  }

  #finish(): void {
    this.#state = "closed";
    this.#clearAlgorithms();
    this.#currentReader?.finish();
    this.#resolvePendingAsClosed();
  }

  /** @internal */ fail(error: unknown): void {
    if (this.#state !== "readable") {
      return;
    }
    this.#state = "errored";
    this.#storedError = error;
    this.#queue.reset();
    this.#clearAlgorithms();
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
    return this.#highWaterMark - this.#queue.totalSize;
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
    if (source === null || pullAlgorithm === undefined) {
      return;
    }
    this.#pulling = true;
    let pullResult: void | PromiseLike<void>;
    try {
      pullResult = pullAlgorithm.call(source, this.#controller);
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

  get [Symbol.toStringTag](): "ReadableStream" {
    return "ReadableStream";
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

  get [Symbol.toStringTag](): "ReadableStreamDefaultController" {
    return "ReadableStreamDefaultController";
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

  get [Symbol.toStringTag](): "ReadableStreamDefaultReader" {
    return "ReadableStreamDefaultReader";
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
      pull(controller) {
        if (position === bytes.length) {
          controller.close();
          return;
        }
        const end = Math.min(position + chunkSize, bytes.length);
        controller.enqueue(bytes.subarray(position, end));
        position = end;
      },
    },
    { highWaterMark: 0, size: (chunk) => chunk.length },
  );
}

/**
 * The source becomes disturbed immediately and stays locked, matching Fetch body
 * transfer. The proxy stream owns its reader even after a terminal transition.
 */
export function transfer<T>(stream: ReadableStream<T>): ReadableStream<T> {
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
