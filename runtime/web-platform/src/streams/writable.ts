import { createAbortSignal, type AbortSignal } from "../core/abort.ts";
import { ignoreRejection } from "../core/promise.ts";
import { requireDictionary } from "../core/webidl.ts";
import { Fifo } from "./fifo.ts";
import { QueueWithSizes } from "./queue-with-sizes.ts";
import {
  extractHighWaterMark,
  extractSizeAlgorithm,
  type QueuingStrategy,
  type QueuingStrategySize,
} from "./queuing-strategy.ts";

export type UnderlyingSinkStartCallback<W> = (
  this: UnderlyingSink<W>,
  controller: WritableStreamDefaultController<W>,
) => void | PromiseLike<void>;

export type UnderlyingSinkWriteCallback<W> = (
  this: UnderlyingSink<W>,
  chunk: W | undefined,
  controller: WritableStreamDefaultController<W>,
) => void | PromiseLike<void>;

export type UnderlyingSinkCloseCallback<W> = (this: UnderlyingSink<W>) => void | PromiseLike<void>;
export type UnderlyingSinkAbortCallback<W> = (
  this: UnderlyingSink<W>,
  reason: unknown,
) => void | PromiseLike<void>;

export interface UnderlyingSink<W> {
  abort?: UnderlyingSinkAbortCallback<W>;
  close?: UnderlyingSinkCloseCallback<W>;
  start?: UnderlyingSinkStartCallback<W>;
  type?: undefined;
  write?: UnderlyingSinkWriteCallback<W>;
}

type WritableStateName = "writable" | "erroring" | "errored" | "closed";
type PromiseState = "pending" | "fulfilled" | "rejected";

interface PendingAbortRequest {
  readonly capability: PromiseWithResolvers<void>;
  readonly reason: unknown;
  readonly wasAlreadyErroring: boolean;
}

/** A writer promise whose identity changes only when the Standard requires it. */
class WriterPromise {
  #capability = Promise.withResolvers<void>();
  #state: PromiseState = "pending";

  constructor(state: PromiseState, reason?: unknown) {
    ignoreRejection(this.#capability.promise);
    if (state === "fulfilled") {
      this.resolve();
    } else if (state === "rejected") {
      this.reject(reason);
    }
  }

  get promise(): Promise<void> {
    return this.#capability.promise;
  }

  replacePending(): void {
    this.#capability = Promise.withResolvers<void>();
    this.#state = "pending";
    ignoreRejection(this.#capability.promise);
  }

  resolve(): void {
    if (this.#state !== "pending") {
      return;
    }
    this.#state = "fulfilled";
    this.#capability.resolve();
  }

  reject(reason: unknown): void {
    if (this.#state !== "pending") {
      this.replacePending();
    }
    this.#state = "rejected";
    this.#capability.reject(reason);
  }
}

interface WritableWriterState<W> {
  stream: WritableStreamState<W> | null;
  readonly ready: WriterPromise;
  readonly closed: WriterPromise;
}

const writableStreamState = Symbol("WritableStream state");
const writableWriterState = Symbol("WritableStreamDefaultWriter state");
const writableControllerKey: unique symbol = Symbol("construct WritableStreamDefaultController");
const defaultUnderlyingSink = {
  abort: undefined,
  close: undefined,
  start: undefined,
  type: undefined,
  write: undefined,
};
const defaultWritableStrategy = {
  highWaterMark: undefined,
  size: undefined,
};

/**
 * The Streams Standard's writable state machine. Requests and chunks are kept
 * in separate FIFO structures because a chunk remains in the size-accounted
 * queue while its corresponding write request is in flight.
 */
class WritableStreamState<W> {
  readonly #queue = new QueueWithSizes<W | undefined | typeof closeSentinel>();
  readonly #writeRequests = new Fifo<PromiseWithResolvers<void>>();
  readonly #abortSignal = createAbortSignal();
  readonly #controller: WritableStreamDefaultController<W>;
  readonly #highWaterMark: number;
  #sizeAlgorithm: QueuingStrategySize<W | undefined> | undefined;
  #sink: UnderlyingSink<W> | null;
  #startAlgorithm: UnderlyingSinkStartCallback<W> | undefined;
  #writeAlgorithm: UnderlyingSinkWriteCallback<W> | undefined;
  #closeAlgorithm: UnderlyingSinkCloseCallback<W> | undefined;
  #abortAlgorithm: UnderlyingSinkAbortCallback<W> | undefined;
  #writer: WritableStreamDefaultWriter<W> | null = null;
  #state: WritableStateName = "writable";
  #storedError: unknown;
  #closeRequest: PromiseWithResolvers<void> | null = null;
  #inFlightWriteRequest: PromiseWithResolvers<void> | null = null;
  #inFlightCloseRequest: PromiseWithResolvers<void> | null = null;
  #pendingAbortRequest: PendingAbortRequest | null = null;
  #backpressure = false;
  #started = false;

  constructor(
    sink: UnderlyingSink<W>,
    highWaterMark: number,
    sizeAlgorithm: QueuingStrategySize<W | undefined>,
  ) {
    requireDictionary(sink, "Underlying sink");
    if (sink === null) {
      throw new TypeError("Underlying sink must be an object");
    }

    const type = sink.type;
    if (type !== undefined) {
      throw new RangeError("WritableStream does not support an underlying sink type");
    }

    const startAlgorithm = sink.start;
    if (startAlgorithm !== undefined && typeof startAlgorithm !== "function") {
      throw new TypeError("Underlying sink start must be callable");
    }
    const writeAlgorithm = sink.write;
    if (writeAlgorithm !== undefined && typeof writeAlgorithm !== "function") {
      throw new TypeError("Underlying sink write must be callable");
    }
    const closeAlgorithm = sink.close;
    if (closeAlgorithm !== undefined && typeof closeAlgorithm !== "function") {
      throw new TypeError("Underlying sink close must be callable");
    }
    const abortAlgorithm = sink.abort;
    if (abortAlgorithm !== undefined && typeof abortAlgorithm !== "function") {
      throw new TypeError("Underlying sink abort must be callable");
    }

    this.#sink = sink;
    this.#startAlgorithm = startAlgorithm;
    this.#writeAlgorithm = writeAlgorithm;
    this.#closeAlgorithm = closeAlgorithm;
    this.#abortAlgorithm = abortAlgorithm;
    this.#highWaterMark = highWaterMark;
    this.#sizeAlgorithm = sizeAlgorithm;
    this.#controller = new WritableStreamDefaultController(writableControllerKey, this);
    this.#updateBackpressure();

    const startResult = this.#invokeStart();
    this.#startAlgorithm = undefined;
    this.#observeStart(startResult);
  }

  async #observeStart(startResult: void | PromiseLike<void>): Promise<void> {
    try {
      await startResult;
      this.#started = true;
      this.#advanceQueueIfNeeded();
    } catch (error) {
      this.#started = true;
      this.#dealWithRejection(error);
    }
  }

  get locked(): boolean {
    return this.#writer !== null;
  }

  get stateName(): WritableStateName {
    return this.#state;
  }

  get storedError(): unknown {
    return this.#storedError;
  }

  get closeQueuedOrInFlight(): boolean {
    return this.#closeQueuedOrInFlight();
  }

  get signal(): AbortSignal {
    return this.#abortSignal;
  }

  get desiredSize(): number | null {
    if (this.#state === "errored" || this.#state === "erroring") {
      return null;
    }
    if (this.#state === "closed") {
      return 0;
    }
    return this.#highWaterMark - this.#queue.totalSize;
  }

  attachWriter(writer: WritableStreamDefaultWriter<W>): WritableWriterState<W> {
    if (this.#writer !== null) {
      throw new TypeError("WritableStream is locked");
    }
    this.#writer = writer;

    let readyState: PromiseState;
    let closedState: PromiseState;
    if (this.#state === "writable") {
      readyState = !this.#closeQueuedOrInFlight() && this.#backpressure ? "pending" : "fulfilled";
      closedState = "pending";
    } else if (this.#state === "erroring") {
      readyState = "rejected";
      closedState = "pending";
    } else if (this.#state === "closed") {
      readyState = "fulfilled";
      closedState = "fulfilled";
    } else {
      readyState = "rejected";
      closedState = "rejected";
    }

    return {
      stream: this,
      ready: new WriterPromise(readyState, this.#storedError),
      closed: new WriterPromise(closedState, this.#storedError),
    };
  }

  releaseWriter(writer: WritableStreamDefaultWriter<W>, state: WritableWriterState<W>): void {
    if (this.#writer !== writer || state.stream !== this) {
      return;
    }
    const error = new TypeError("Writer has been released");
    state.ready.reject(error);
    state.closed.reject(error);
    this.#writer = null;
    state.stream = null;
  }

  write(writer: WritableStreamDefaultWriter<W>, chunk: W | undefined): Promise<void> {
    const writerState = writer[writableWriterState];
    const stream = writerState.stream;
    if (stream === null) {
      return Promise.reject(new TypeError("Writer has been released"));
    }

    const chunkSize = this.#getChunkSize(chunk);
    if (stream !== writerState.stream) {
      return Promise.reject(new TypeError("Writer is bound to a different WritableStream"));
    }
    if (this.#state === "errored" || this.#state === "erroring") {
      return Promise.reject(this.#storedError);
    }
    if (this.#closeQueuedOrInFlight() || this.#state === "closed") {
      return Promise.reject(new TypeError("WritableStream is closed"));
    }

    const request = Promise.withResolvers<void>();
    this.#writeRequests.enqueue(request);
    try {
      this.#queue.enqueue(chunk, chunkSize);
    } catch (error) {
      this.#errorIfNeeded(error);
      return request.promise;
    }
    this.#updateBackpressure();
    this.#advanceQueueIfNeeded();
    return request.promise;
  }

  close(): Promise<void> {
    if (this.#state === "closed" || this.#state === "errored") {
      return Promise.reject(new TypeError("WritableStream is closed"));
    }
    if (this.#closeQueuedOrInFlight()) {
      return Promise.reject(new TypeError("WritableStream is already closing"));
    }

    const request = Promise.withResolvers<void>();
    this.#closeRequest = request;
    if (this.#writer !== null && this.#backpressure && this.#state === "writable") {
      this.#writer[writableWriterState].ready.resolve();
    }
    this.#queue.enqueue(closeSentinel, 0);
    this.#advanceQueueIfNeeded();
    return request.promise;
  }

  abort(reason: unknown): Promise<void> {
    if (this.#isTerminal()) {
      return Promise.resolve();
    }

    this.#abortSignal.trigger(reason);
    if (this.#isTerminal()) {
      return Promise.resolve();
    }
    if (this.#pendingAbortRequest !== null) {
      return this.#pendingAbortRequest.capability.promise;
    }

    const wasAlreadyErroring = this.#state === "erroring";
    const request = Promise.withResolvers<void>();
    this.#pendingAbortRequest = {
      capability: request,
      reason: wasAlreadyErroring ? undefined : reason,
      wasAlreadyErroring,
    };
    if (!wasAlreadyErroring) {
      this.#startErroring(reason);
    }
    return request.promise;
  }

  error(reason: unknown): void {
    if (this.#state !== "writable") {
      return;
    }
    this.#clearAlgorithms();
    this.#startErroring(reason);
  }

  #invokeStart(): void | PromiseLike<void> {
    const start = this.#startAlgorithm;
    const sink = this.#sink;
    if (start === undefined || sink === null) {
      return;
    }
    return start.call(sink, this.#controller);
  }

  #invokeWrite(chunk: W | undefined): Promise<void> {
    const write = this.#writeAlgorithm;
    const sink = this.#sink;
    if (write === undefined || sink === null) {
      return Promise.resolve();
    }
    try {
      return Promise.resolve(write.call(sink, chunk, this.#controller));
    } catch (error) {
      return Promise.reject(error);
    }
  }

  #invokeClose(): Promise<void> {
    const close = this.#closeAlgorithm;
    const sink = this.#sink;
    if (close === undefined || sink === null) {
      return Promise.resolve();
    }
    try {
      return Promise.resolve(close.call(sink));
    } catch (error) {
      return Promise.reject(error);
    }
  }

  #invokeAbort(reason: unknown): Promise<void> {
    const abort = this.#abortAlgorithm;
    const sink = this.#sink;
    if (abort === undefined || sink === null) {
      return Promise.resolve();
    }
    try {
      return Promise.resolve(abort.call(sink, reason));
    } catch (error) {
      return Promise.reject(error);
    }
  }

  #getChunkSize(chunk: W | undefined): number {
    try {
      const size = this.#sizeAlgorithm;
      if (size === undefined) {
        return 1;
      }
      return size(chunk);
    } catch (error) {
      this.#errorIfNeeded(error);
      return 1;
    }
  }

  #errorIfNeeded(reason: unknown): void {
    if (this.#state === "writable") {
      this.error(reason);
    }
  }

  #advanceQueueIfNeeded(): void {
    if (!this.#started || this.#inFlightWriteRequest !== null) {
      return;
    }
    if (this.#state === "erroring") {
      this.#finishErroring();
      return;
    }
    const entry = this.#queue.peek();
    if (entry === undefined) {
      return;
    }
    if (entry.value === closeSentinel) {
      this.#processClose();
    } else {
      this.#processWrite(entry.value);
    }
  }

  #processWrite(chunk: W | undefined): void {
    const request = this.#writeRequests.dequeue();
    if (request === undefined) {
      throw new Error("WritableStream write queue lost its request");
    }
    this.#inFlightWriteRequest = request;
    const writeResult = this.#invokeWrite(chunk);
    this.#finishWrite(writeResult, request);
  }

  async #finishWrite(
    writeResult: Promise<void>,
    request: PromiseWithResolvers<void>,
  ): Promise<void> {
    try {
      await writeResult;
      request.resolve();
      this.#inFlightWriteRequest = null;
      this.#queue.dequeue();
      if (!this.#closeQueuedOrInFlight() && this.#state === "writable") {
        this.#updateBackpressure();
      }
      this.#advanceQueueIfNeeded();
    } catch (error) {
      request.reject(error);
      this.#inFlightWriteRequest = null;
      this.#queue.dequeue();
      if (this.#state === "writable") {
        this.#clearAlgorithms();
      }
      this.#dealWithRejection(error);
    }
  }

  #processClose(): void {
    const request = this.#closeRequest;
    if (request === null) {
      throw new Error("WritableStream close queue lost its request");
    }
    this.#closeRequest = null;
    this.#inFlightCloseRequest = request;
    this.#queue.dequeue();
    const closeResult = this.#invokeClose();
    this.#clearAlgorithms();
    this.#settleClose(closeResult);
  }

  async #settleClose(closeResult: Promise<void>): Promise<void> {
    try {
      await closeResult;
      this.#finishInFlightClose();
    } catch (error) {
      this.#finishInFlightCloseWithError(error);
    }
  }

  #finishInFlightClose(): void {
    const request = this.#inFlightCloseRequest;
    if (request === null) {
      throw new Error("WritableStream has no in-flight close request");
    }
    request.resolve();
    this.#inFlightCloseRequest = null;
    if (this.#state === "erroring") {
      this.#storedError = undefined;
      const abortRequest = this.#pendingAbortRequest;
      if (abortRequest !== null) {
        abortRequest.capability.resolve();
        this.#pendingAbortRequest = null;
      }
    }
    this.#state = "closed";
    this.#writer?.[writableWriterState].closed.resolve();
  }

  #finishInFlightCloseWithError(error: unknown): void {
    const request = this.#inFlightCloseRequest;
    if (request === null) {
      throw new Error("WritableStream has no in-flight close request");
    }
    request.reject(error);
    this.#inFlightCloseRequest = null;
    const abortRequest = this.#pendingAbortRequest;
    if (abortRequest !== null) {
      abortRequest.capability.reject(error);
      this.#pendingAbortRequest = null;
    }
    this.#dealWithRejection(error);
  }

  #dealWithRejection(error: unknown): void {
    if (this.#state === "writable") {
      this.#startErroring(error);
      return;
    }
    if (this.#state === "erroring") {
      this.#finishErroring();
    }
  }

  #startErroring(reason: unknown): void {
    this.#state = "erroring";
    this.#storedError = reason;
    this.#writer?.[writableWriterState].ready.reject(reason);
    if (!this.#hasOperationInFlight() && this.#started) {
      this.#finishErroring();
    }
  }

  #finishErroring(): void {
    this.#state = "errored";
    this.#queue.reset();
    while (!this.#writeRequests.empty) {
      this.#writeRequests.dequeue()?.reject(this.#storedError);
    }

    const abortRequest = this.#pendingAbortRequest;
    if (abortRequest === null) {
      this.#rejectCloseAndClosed();
      return;
    }
    this.#pendingAbortRequest = null;
    if (abortRequest.wasAlreadyErroring) {
      abortRequest.capability.reject(this.#storedError);
      this.#rejectCloseAndClosed();
      return;
    }

    const abortResult = this.#invokeAbort(abortRequest.reason);
    this.#clearAlgorithms();
    this.#settleAbort(abortResult, abortRequest);
  }

  async #settleAbort(abortResult: Promise<void>, abortRequest: PendingAbortRequest): Promise<void> {
    try {
      await abortResult;
      abortRequest.capability.resolve();
    } catch (error) {
      abortRequest.capability.reject(error);
    }
    this.#rejectCloseAndClosed();
  }

  #rejectCloseAndClosed(): void {
    const closeRequest = this.#closeRequest;
    if (closeRequest !== null) {
      closeRequest.reject(this.#storedError);
      this.#closeRequest = null;
    }
    this.#writer?.[writableWriterState].closed.reject(this.#storedError);
  }

  #updateBackpressure(): void {
    const backpressure = this.#highWaterMark - this.#queue.totalSize <= 0;
    if (this.#writer !== null && this.#backpressure !== backpressure) {
      const ready = this.#writer[writableWriterState].ready;
      if (backpressure) {
        ready.replacePending();
      } else {
        ready.resolve();
      }
    }
    this.#backpressure = backpressure;
  }

  #closeQueuedOrInFlight(): boolean {
    return this.#closeRequest !== null || this.#inFlightCloseRequest !== null;
  }

  #hasOperationInFlight(): boolean {
    return this.#inFlightWriteRequest !== null || this.#inFlightCloseRequest !== null;
  }

  #isTerminal(): boolean {
    return this.#state === "closed" || this.#state === "errored";
  }

  #clearAlgorithms(): void {
    this.#sink = null;
    this.#startAlgorithm = undefined;
    this.#writeAlgorithm = undefined;
    this.#closeAlgorithm = undefined;
    this.#abortAlgorithm = undefined;
    this.#sizeAlgorithm = undefined;
  }
}

const closeSentinel: unique symbol = Symbol("WritableStream close");

export class WritableStream<W = unknown> {
  readonly [writableStreamState]: WritableStreamState<W>;

  constructor(
    underlyingSink: UnderlyingSink<W> = defaultUnderlyingSink,
    strategy: QueuingStrategy<W | undefined> | null = defaultWritableStrategy,
  ) {
    const sizeAlgorithm = extractSizeAlgorithm(strategy);
    const highWaterMark = extractHighWaterMark(strategy, 1);
    this[writableStreamState] = new WritableStreamState(
      underlyingSink,
      highWaterMark,
      sizeAlgorithm,
    );
  }

  get locked(): boolean {
    return this[writableStreamState].locked;
  }

  abort(reason: unknown = undefined): Promise<void> {
    if (this.locked) {
      return Promise.reject(new TypeError("WritableStream is locked"));
    }
    return this[writableStreamState].abort(reason);
  }

  close(): Promise<void> {
    if (this.locked) {
      return Promise.reject(new TypeError("WritableStream is locked"));
    }
    return this[writableStreamState].close();
  }

  getWriter(): WritableStreamDefaultWriter<W> {
    return new WritableStreamDefaultWriter(this);
  }


  // Web IDL surface shape; see core/interface-tag.ts for the rule and why it is
  // written inline rather than through a helper.
  static {
    Object.defineProperty(this.prototype, Symbol.toStringTag, {
      value: "WritableStream",
      writable: false,
      enumerable: false,
      configurable: true,
    });
  }
}

/** @internal */
export function isWritableStream<W>(value: unknown): value is WritableStream<W> {
  return value instanceof WritableStream && value[writableStreamState] !== undefined;
}

export class WritableStreamDefaultWriter<W = unknown> {
  readonly [writableWriterState]: WritableWriterState<W>;

  constructor(stream: WritableStream<W>) {
    if (!(stream instanceof WritableStream)) {
      throw new TypeError("stream must be a WritableStream");
    }
    this[writableWriterState] = stream[writableStreamState].attachWriter(this);
  }

  get closed(): Promise<void> {
    return this[writableWriterState].closed.promise;
  }

  get desiredSize(): number | null {
    const stream = this[writableWriterState].stream;
    if (stream === null) {
      throw new TypeError("Writer has been released");
    }
    return stream.desiredSize;
  }

  get ready(): Promise<void> {
    return this[writableWriterState].ready.promise;
  }

  abort(reason: unknown = undefined): Promise<void> {
    const stream = this[writableWriterState].stream;
    if (stream === null) {
      return Promise.reject(new TypeError("Writer has been released"));
    }
    return stream.abort(reason);
  }

  close(): Promise<void> {
    const stream = this[writableWriterState].stream;
    if (stream === null) {
      return Promise.reject(new TypeError("Writer has been released"));
    }
    return stream.close();
  }

  releaseLock(): void {
    const state = this[writableWriterState];
    state.stream?.releaseWriter(this, state);
  }

  write(...args: [] | [chunk: W]): Promise<void> {
    const stream = this[writableWriterState].stream;
    if (stream === null) {
      return Promise.reject(new TypeError("Writer has been released"));
    }
    return stream.write(this, args[0]);
  }


  // Web IDL surface shape; see core/interface-tag.ts for the rule and why it is
  // written inline rather than through a helper.
  static {
    Object.defineProperty(this.prototype, Symbol.toStringTag, {
      value: "WritableStreamDefaultWriter",
      writable: false,
      enumerable: false,
      configurable: true,
    });
  }
}

/** @internal */
export function acquireWritableStreamDefaultWriter<W>(
  stream: WritableStream<W>,
): WritableStreamDefaultWriter<W> {
  return new WritableStreamDefaultWriter(stream);
}

/** @internal */
export function writableStreamDefaultWriterReady<W>(
  writer: WritableStreamDefaultWriter<W>,
): Promise<void> {
  return writer[writableWriterState].ready.promise;
}

/** @internal */
export function writableStreamDefaultWriterClosed<W>(
  writer: WritableStreamDefaultWriter<W>,
): Promise<void> {
  return writer[writableWriterState].closed.promise;
}

/** @internal */
export function writableStreamCanAcceptWrites<W>(stream: WritableStream<W>): boolean {
  const state = stream[writableStreamState];
  return state.stateName === "writable" && !state.closeQueuedOrInFlight;
}

/** @internal */
export function writableStreamIsWritable<W>(stream: WritableStream<W>): boolean {
  return stream[writableStreamState].stateName === "writable";
}

/** @internal */
export function writableStreamIsClosingOrClosed<W>(stream: WritableStream<W>): boolean {
  const state = stream[writableStreamState];
  return state.stateName === "closed" || state.closeQueuedOrInFlight;
}

/** @internal */
export function writableStreamIsErrored<W>(stream: WritableStream<W>): boolean {
  const state = stream[writableStreamState].stateName;
  return state === "errored" || state === "erroring";
}

/** @internal */
export function writableStreamIsFullyErrored<W>(stream: WritableStream<W>): boolean {
  return stream[writableStreamState].stateName === "errored";
}

/** @internal */
export function writableStreamStoredError<W>(stream: WritableStream<W>): unknown {
  return stream[writableStreamState].storedError;
}

/** @internal */
export function writableStreamError<W>(stream: WritableStream<W>, reason: unknown): void {
  stream[writableStreamState].error(reason);
}

/** @internal */
export function writableStreamDefaultWriterAbort<W>(
  writer: WritableStreamDefaultWriter<W>,
  reason: unknown,
): Promise<void> {
  const stream = writer[writableWriterState].stream;
  if (stream === null) {
    return Promise.reject(new TypeError("Writer has been released"));
  }
  return stream.abort(reason);
}

/** @internal */
export function writableStreamDefaultWriterClose<W>(
  writer: WritableStreamDefaultWriter<W>,
): Promise<void> {
  const stream = writer[writableWriterState].stream;
  if (stream === null) {
    return Promise.reject(new TypeError("Writer has been released"));
  }
  return stream.close();
}

/** @internal */
export function writableStreamDefaultWriterCloseWithErrorPropagation<W>(
  writer: WritableStreamDefaultWriter<W>,
): Promise<void> {
  const state = writer[writableWriterState];
  const stream = state.stream;
  if (stream === null) {
    return Promise.reject(new TypeError("Writer has been released"));
  }
  if (stream.stateName === "closed" || stream.closeQueuedOrInFlight) {
    return state.closed.promise;
  }
  if (stream.stateName === "errored" || stream.stateName === "erroring") {
    return Promise.reject(stream.storedError);
  }
  return stream.close();
}

/** @internal */
export function writableStreamDefaultWriterRelease<W>(
  writer: WritableStreamDefaultWriter<W>,
): void {
  const state = writer[writableWriterState];
  state.stream?.releaseWriter(writer, state);
}

/** @internal */
export function writableStreamDefaultWriterWrite<W>(
  writer: WritableStreamDefaultWriter<W>,
  chunk: W,
): Promise<void> {
  const stream = writer[writableWriterState].stream;
  if (stream === null) {
    return Promise.reject(new TypeError("Writer has been released"));
  }
  return stream.write(writer, chunk);
}

export class WritableStreamDefaultController<W = unknown> {
  readonly #stream: WritableStreamState<W>;

  constructor(...args: [typeof writableControllerKey, WritableStreamState<W>]) {
    const key = args[0];
    const stream = args[1];
    if (key !== writableControllerKey || stream === undefined) {
      throw new TypeError("Illegal constructor");
    }
    this.#stream = stream;
  }

  get signal(): AbortSignal {
    return this.#stream.signal;
  }

  error(reason: unknown = undefined): void {
    this.#stream.error(reason);
  }


  // Web IDL surface shape; see core/interface-tag.ts for the rule and why it is
  // written inline rather than through a helper.
  static {
    Object.defineProperty(this.prototype, Symbol.toStringTag, {
      value: "WritableStreamDefaultController",
      writable: false,
      enumerable: false,
      configurable: true,
    });
  }
}
