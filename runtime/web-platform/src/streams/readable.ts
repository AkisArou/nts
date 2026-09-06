import { LimitError } from "../core/errors.ts";
import { ignoreRejection } from "../core/promise.ts";
import { AbortSignal } from "../core/abort.ts";
import { coerceToBoolean, coerceToDOMString, requireDictionary } from "../core/webidl.ts";
import { Fifo } from "./fifo.ts";
import { QueueWithSizes } from "./queue-with-sizes.ts";
import {
  extractHighWaterMark,
  extractSizeAlgorithm,
  type QueuingStrategy,
  type QueuingStrategySize,
} from "./queuing-strategy.ts";
import { WritableStream, type WritableStreamDefaultWriter } from "./writable.ts";

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
  if (signal !== undefined && !(signal instanceof AbortSignal)) {
    throw new TypeError("Stream pipe signal must be an AbortSignal");
  }
  return { preventAbort, preventCancel, preventClose, signal };
}

/**
 * Default-reader Streams implementation. Reads are pull-driven, with a single
 * in-flight underlying pull and explicit ownership; byte/BYOB support is separate.
 */
export class ReadableStream<T> {
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

  constructor(source: UnderlyingSource<T> | null = {}, strategy: QueuingStrategy<T> | null = {}) {
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
    Promise.resolve(startResult).then(
      () => {
        this.#started = true;
        this.#maybePull();
      },
      (error) => this.fail(error),
    );
  }

  get locked(): boolean {
    return this.#currentReader !== null;
  }

  /** @internal */ get disturbed(): boolean {
    return this.#isDisturbed;
  }

  /** @internal */ get queuedSize(): number {
    return this.#queue.totalSize;
  }

  /** @internal */ markDisturbed(): void {
    this.#isDisturbed = true;
  }

  getReader(options: ReadableStreamGetReaderOptions | null = {}): ReadableStreamDefaultReader<T> {
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
    options: StreamPipeOptions | null = {},
  ): ReadableStream<R> {
    if (transform === null || typeof transform !== "object") {
      throw new TypeError("Stream transform must be a readable/writable pair");
    }
    const readable = transform.readable;
    const writable = transform.writable;
    if (!(readable instanceof ReadableStream) || !(writable instanceof WritableStream)) {
      throw new TypeError("Stream transform must contain readable and writable streams");
    }
    const piping = this.pipeTo(writable, options);
    ignoreRejection(piping);
    return readable;
  }

  pipeTo(destination: WritableStream<T>, options: StreamPipeOptions | null = {}): Promise<void> {
    const converted = convertPipeOptions(options);
    if (!(destination instanceof WritableStream)) {
      return Promise.reject(new TypeError("Destination must be a WritableStream"));
    }
    if (this.locked) {
      return Promise.reject(new TypeError("ReadableStream is locked"));
    }
    if (destination.locked) {
      return Promise.reject(new TypeError("WritableStream is locked"));
    }
    const reader = this.getReader();
    const writer = destination.getWriter();
    return pipeReadableToWritable(reader, writer, converted);
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
    Promise.resolve(pullResult).then(
      () => {
        this.#pulling = false;
        if (this.#pullAgain) {
          this.#pullAgain = false;
          this.#maybePull();
        }
      },
      (error) => {
        this.#pulling = false;
        this.fail(error);
      },
    );
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
  async *values(options: { preventCancel?: boolean } = {}): AsyncGenerator<T, void, unknown> {
    const reader = this.getReader();
    let ended = false;
    try {
      while (true) {
        const result = await reader.read();
        if (result.done) {
          ended = true;
          return;
        }
        yield result.value;
      }
    } finally {
      try {
        if (!ended && !options.preventCancel) {
          await reader.cancel();
        }
      } finally {
        reader.releaseLock();
      }
    }
  }

  [Symbol.asyncIterator](): AsyncGenerator<T, void, unknown> {
    return this.values();
  }

  get [Symbol.toStringTag](): "ReadableStream" {
    return "ReadableStream";
  }
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

async function pipeReadableToWritable<T>(
  reader: ReadableStreamDefaultReader<T>,
  writer: WritableStreamDefaultWriter<T>,
  options: ConvertedPipeOptions,
): Promise<void> {
  const aborted = Promise.withResolvers<never>();
  ignoreRejection(aborted.promise);
  let aborting = false;
  const unsubscribe = options.signal?.subscribe(() => {
    aborting = true;
    aborted.reject(options.signal?.reason);
  });

  const waitFor = <R>(promise: Promise<R>): Promise<R> =>
    options.signal === undefined ? promise : Promise.race([promise, aborted.promise]);

  try {
    while (true) {
      try {
        await waitFor(writer.ready);
      } catch (error) {
        if (aborting) throw error;
        if (!options.preventCancel) await reader.cancel(error);
        throw error;
      }

      let result: ReadResult<T>;
      try {
        result = await waitFor(reader.read());
      } catch (error) {
        if (aborting) throw error;
        if (!options.preventAbort) await writer.abort(error);
        throw error;
      }

      if (result.done) {
        if (!options.preventClose) await waitFor(writer.close());
        return;
      }

      try {
        await waitFor(writer.write(result.value));
      } catch (error) {
        if (aborting) throw error;
        if (!options.preventCancel) await reader.cancel(error);
        throw error;
      }
    }
  } catch (error) {
    if (!aborting) throw error;
    const reason = options.signal?.reason;
    const actions: Promise<void>[] = [];
    if (!options.preventAbort) actions.push(writer.abort(reason));
    if (!options.preventCancel) actions.push(reader.cancel(reason));
    await Promise.all(actions);
    throw reason;
  } finally {
    unsubscribe?.();
    reader.releaseLock();
    writer.releaseLock();
  }
}

export interface TeeOptions<T> {
  clone?: (chunk: T) => T;
  size?: (chunk: T) => number;
  /** Infinity is standards-shaped. A finite cap is an explicit NTS safety policy. */
  maxBufferedSize?: number;
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
    this.reader = stream.getReader();
    this.branches = [new TeeBranch(this, 0, this.size), new TeeBranch(this, 1, this.size)];
    ignoreRejection(this.canceled.promise);
    const closedObservation = this.reader.closed.then(
      () => this.sourceClosed(),
      (error) => this.sourceErrored(error),
    );
    ignoreRejection(closedObservation);
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
      cancellation.then(
        () => {
          this.canceled.resolve();
        },
        (error) => {
          this.canceled.reject(error);
        },
      );
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
    cancellation.then(
      () => this.canceled.resolve(),
      (cancelError) => this.canceled.reject(cancelError),
    );
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
  options: TeeOptions<T> = {},
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
