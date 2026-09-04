// Push-model multi-consumer byte streaming from Node v24.20.0
// `lib/internal/streams/iter/broadcast.js`.

import {
  AbortError,
  ERR_INVALID_ARG_TYPE,
  ERR_INVALID_RETURN_VALUE,
  ERR_INVALID_STATE_RANGE,
  ERR_INVALID_STATE_TYPE,
} from "../../../internal/errors.ts";
import {
  validateInteger,
  validateObject,
} from "../../../internal/validators.ts";
import { pull } from "./pull.ts";
import { from } from "./from.ts";
import { RingBuffer } from "./ring-buffer.ts";
import {
  broadcastProtocol,
  drainableProtocol,
  hasBroadcastProtocol,
} from "./types.ts";
import {
  type AsyncByteStream,
  type BackpressurePolicy,
  type ByteBatch,
  convertChunks,
  getWriterSignal,
  type StreamAbortSignal,
  throwIfAborted,
  toUint8Array,
  validateBackpressure,
  type WriterOptions,
  wrapError,
} from "./utils.ts";

const DEFAULT_BUDGET = 65_536;
const MINIMUM_BUDGET = 16_384;
const resolvedVoid = Promise.resolve();
const doneResult: IteratorResult<ByteBatch> = { value: undefined, done: true };
const donePromise = Promise.resolve(doneResult);

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

interface ParsedBroadcastOptions {
  readonly budget: number;
  readonly backpressure: BackpressurePolicy;
  readonly signal?: StreamAbortSignal;
}

function validateSignal(
  signal: unknown,
): asserts signal is StreamAbortSignal | undefined {
  if (
    signal !== undefined &&
    (signal === null || typeof signal !== "object" || !("aborted" in signal))
  ) {
    throw new ERR_INVALID_ARG_TYPE("options.signal", "AbortSignal", signal);
  }
}

function parseOptions(options: unknown): ParsedBroadcastOptions {
  validateObject(options, "options");
  const budget = "budget" in options && options.budget !== undefined
    ? options.budget
    : DEFAULT_BUDGET;
  validateInteger(budget, "options.budget", MINIMUM_BUDGET);
  const backpressure = "backpressure" in options && options.backpressure !== undefined
    ? options.backpressure
    : "strict";
  validateBackpressure(backpressure);
  const signal = "signal" in options ? options.signal : undefined;
  validateSignal(signal);
  return { budget, backpressure, signal };
}

function batchByteSize(batch: ByteBatch): number {
  let size = 0;
  for (let i = 0; i < batch.length; i++) size += batch[i]?.byteLength ?? 0;
  return size;
}

class BroadcastConsumerState {
  cursor: number;
  resolve: ((result: IteratorResult<ByteBatch>) => void) | null = null;
  reject: ((reason?: unknown) => void) | null = null;
  readonly pending = new RingBuffer<Deferred<IteratorResult<ByteBatch>>>();
  detached = false;

  constructor(cursor: number) {
    this.cursor = cursor;
  }
}

class BroadcastConsumerIterator implements AsyncIterator<ByteBatch> {
  readonly #broadcast: BroadcastController;
  readonly #state: BroadcastConsumerState;

  constructor(broadcast: BroadcastController, state: BroadcastConsumerState) {
    this.#broadcast = broadcast;
    this.#state = state;
  }

  next(): Promise<IteratorResult<ByteBatch>> {
    return this.#broadcast.next(this.#state);
  }

  return(): Promise<IteratorResult<ByteBatch>> {
    this.#broadcast.detach(this.#state);
    return donePromise;
  }

  throw(_error?: unknown): Promise<IteratorResult<ByteBatch>> {
    this.#broadcast.detach(this.#state);
    return donePromise;
  }
}

class BroadcastConsumer implements AsyncByteStream {
  readonly #broadcast: BroadcastController;
  readonly #state: BroadcastConsumerState;

  constructor(broadcast: BroadcastController, state: BroadcastConsumerState) {
    this.#broadcast = broadcast;
    this.#state = state;
  }

  [Symbol.asyncIterator](): AsyncIterator<ByteBatch> {
    return new BroadcastConsumerIterator(this.#broadcast, this.#state);
  }
}

/** Shared buffer and independent cursor state for one broadcast channel. */
export class BroadcastController {
  readonly #buffer = new RingBuffer<ByteBatch>();
  readonly #consumers = new Set<BroadcastConsumerState>();
  #waiters: BroadcastConsumerState[] = [];
  readonly #options: ParsedBroadcastOptions;
  #writer: BroadcastWriter | null = null;
  #bufferStart = 0;
  #bufferedBytes = 0;
  #cachedMinCursor = 0;
  #cachedMinCursorConsumers = 0;
  #ended = false;
  #cancelled = false;
  #hasError = false;
  #error: unknown;
  #onBufferDrained: (() => void) | null = null;

  constructor(options: ParsedBroadcastOptions) {
    this.#options = options;
  }

  setWriter(writer: BroadcastWriter): void {
    this.#writer = writer;
  }

  setOnBufferDrained(callback: () => void): void {
    this.#onBufferDrained = callback;
  }

  get backpressurePolicy(): BackpressurePolicy {
    return this.#options.backpressure;
  }

  get consumerCount(): number {
    return this.#consumers.size;
  }

  push(...args: unknown[]): AsyncByteStream {
    const state = new BroadcastConsumerState(this.#bufferStart);
    this.#consumers.add(state);
    if (this.#consumers.size === 1) {
      this.#cachedMinCursor = state.cursor;
      this.#cachedMinCursorConsumers = 1;
    } else if (state.cursor === this.#cachedMinCursor) {
      this.#cachedMinCursorConsumers++;
    } else {
      this.#recomputeMinCursor();
    }
    const raw = new BroadcastConsumer(this, state);
    if (args.length === 0) return raw;
    try {
      return pull(raw, ...args);
    } catch (error) {
      this.detach(state);
      throw error;
    }
  }

  next(state: BroadcastConsumerState): Promise<IteratorResult<ByteBatch>> {
    if (state.detached) {
      return this.#hasError ? Promise.reject(this.#error) : donePromise;
    }

    const index = state.cursor - this.#bufferStart;
    if (index < this.#buffer.length) {
      return Promise.resolve({ value: this.#consumeBuffered(state, index), done: false });
    }

    if (this.#hasError) {
      state.detached = true;
      this.#deleteConsumer(state);
      return Promise.reject(this.#error);
    }
    if (this.#ended || this.#cancelled) {
      this.detach(state);
      return donePromise;
    }

    const pending = deferred<IteratorResult<ByteBatch>>();
    if (state.resolve !== null) {
      state.pending.push(pending);
    } else {
      state.resolve = pending.resolve;
      state.reject = pending.reject;
      this.#waiters.push(state);
    }
    return pending.promise;
  }

  detach(state: BroadcastConsumerState): void {
    if (state.detached) return;
    state.detached = true;
    state.resolve?.(doneResult);
    state.resolve = null;
    state.reject = null;
    while (state.pending.length > 0) state.pending.shift()?.resolve(doneResult);
    if (this.#deleteConsumer(state)) this.#tryTrimBuffer();
  }

  cancel(reason?: unknown): void {
    if (this.#cancelled) return;
    this.#cancelled = true;
    this.#ended = true;
    if (reason !== undefined) {
      this.#hasError = true;
      this.#error = reason;
    }
    this.#writer?.cancelPending();

    for (const consumer of this.#consumers) {
      if (consumer.resolve !== null) {
        if (this.#hasError) consumer.reject?.(this.#error);
        else consumer.resolve(doneResult);
        consumer.resolve = null;
        consumer.reject = null;
      }
      while (consumer.pending.length > 0) {
        const pending = consumer.pending.shift();
        if (pending === undefined) continue;
        if (this.#hasError) pending.reject(this.#error);
        else pending.resolve(doneResult);
      }
      consumer.detached = true;
    }
    this.#consumers.clear();
    this.#cachedMinCursorConsumers = 0;
  }

  [Symbol.dispose](): void {
    this.cancel();
  }

  writeBatch(batch: ByteBatch): boolean {
    if (this.#ended || this.#cancelled) return false;
    const size = batchByteSize(batch);
    if (size === 0) return true;

    if (this.#bufferedBytes >= this.#options.budget) {
      if (
        this.#options.backpressure === "strict" ||
        this.#options.backpressure === "unbounded"
      ) return false;
      if (this.#options.backpressure === "drop-newest") return true;

      while (
        this.#bufferedBytes >= this.#options.budget &&
        this.#buffer.length > 0
      ) {
        const removed = this.#buffer.shift();
        if (removed !== undefined) this.#bufferedBytes -= batchByteSize(removed);
        this.#bufferStart++;
      }
      for (const consumer of this.#consumers) {
        if (consumer.cursor < this.#bufferStart) {
          this.#deleteConsumerFromMin(consumer);
          consumer.cursor = this.#bufferStart;
        }
      }
      this.#recomputeMinCursor();
    }

    this.#buffer.push(batch);
    this.#bufferedBytes += size;
    this.#notifyConsumers();
    return true;
  }

  end(): void {
    if (this.#ended) return;
    this.#ended = true;
    for (const consumer of this.#consumers) {
      while (consumer.resolve !== null) {
        const index = consumer.cursor - this.#bufferStart;
        const resolve = consumer.resolve;
        consumer.resolve = null;
        consumer.reject = null;
        if (index < this.#buffer.length) {
          resolve({ value: this.#consumeBuffered(consumer, index), done: false });
          this.#promotePending(consumer);
        } else {
          resolve(doneResult);
          while (consumer.pending.length > 0) {
            consumer.pending.shift()?.resolve(doneResult);
          }
          consumer.detached = true;
          if (this.#deleteConsumer(consumer)) this.#tryTrimBuffer();
          break;
        }
      }
    }
  }

  abort(reason: unknown): void {
    if (this.#ended || this.#hasError) return;
    this.#hasError = true;
    this.#error = reason;
    this.#ended = true;
    for (const consumer of this.#consumers) {
      consumer.reject?.(reason);
      consumer.resolve = null;
      consumer.reject = null;
      while (consumer.pending.length > 0) consumer.pending.shift()?.reject(reason);
      consumer.detached = true;
    }
    this.#consumers.clear();
    this.#cachedMinCursorConsumers = 0;
  }

  canWrite(): boolean | null {
    if (this.#ended || this.#cancelled) return null;
    if (
      (this.#options.backpressure === "strict" ||
        this.#options.backpressure === "unbounded") &&
      this.#bufferedBytes >= this.#options.budget
    ) return false;
    return true;
  }

  #consumeBuffered(state: BroadcastConsumerState, index: number): ByteBatch {
    const batch = this.#buffer.get(index);
    if (batch === undefined) throw new Error("broadcast buffer cursor is out of range");
    const cursor = state.cursor;
    state.cursor++;
    if (
      cursor === this.#cachedMinCursor &&
      --this.#cachedMinCursorConsumers === 0
    ) this.#tryTrimBuffer();
    return batch;
  }

  #notifyConsumers(): void {
    const waiters = this.#waiters;
    if (waiters.length === 0) return;
    this.#waiters = [];
    for (let i = 0; i < waiters.length; i++) {
      const consumer = waiters[i];
      if (consumer === undefined || consumer.resolve === null) continue;
      const index = consumer.cursor - this.#bufferStart;
      if (index >= this.#buffer.length) {
        this.#waiters.push(consumer);
        continue;
      }
      const resolve = consumer.resolve;
      consumer.resolve = null;
      consumer.reject = null;
      resolve({ value: this.#consumeBuffered(consumer, index), done: false });
      if (consumer.detached) {
        if (this.#deleteConsumer(consumer)) this.#tryTrimBuffer();
      } else if (this.#promotePending(consumer)) {
        this.#waiters.push(consumer);
      }
    }
  }

  #promotePending(consumer: BroadcastConsumerState): boolean {
    const next = consumer.pending.shift();
    if (next === undefined) return false;
    consumer.resolve = next.resolve;
    consumer.reject = next.reject;
    return true;
  }

  #tryTrimBuffer(): void {
    if (this.#cachedMinCursorConsumers === 0) this.#recomputeMinCursor();
    const trimCount = this.#cachedMinCursor - this.#bufferStart;
    if (trimCount <= 0) return;
    for (let i = 0; i < trimCount; i++) {
      const removed = this.#buffer.get(i);
      if (removed !== undefined) this.#bufferedBytes -= batchByteSize(removed);
    }
    this.#buffer.trimFront(trimCount);
    this.#bufferStart = this.#cachedMinCursor;
    if (
      this.#onBufferDrained !== null &&
      this.#bufferedBytes < this.#options.budget
    ) this.#onBufferDrained();
  }

  #recomputeMinCursor(): void {
    let min = this.#bufferStart + this.#buffer.length;
    let count = 0;
    for (const consumer of this.#consumers) {
      if (consumer.cursor < min) {
        min = consumer.cursor;
        count = 1;
      } else if (consumer.cursor === min) {
        count++;
      }
    }
    this.#cachedMinCursor = min;
    this.#cachedMinCursorConsumers = count;
  }

  #deleteConsumerFromMin(consumer: BroadcastConsumerState): boolean {
    if (consumer.cursor !== this.#cachedMinCursor) return false;
    this.#cachedMinCursorConsumers--;
    return this.#cachedMinCursorConsumers === 0;
  }

  #deleteConsumer(consumer: BroadcastConsumerState): boolean {
    return this.#consumers.delete(consumer) && this.#deleteConsumerFromMin(consumer);
  }
}

class DrainWaiter {
  readonly resolve: (canWrite: boolean) => void;
  readonly reject: (reason?: unknown) => void;

  constructor(
    resolve: (canWrite: boolean) => void,
    reject: (reason?: unknown) => void,
  ) {
    this.resolve = resolve;
    this.reject = reject;
  }
}

class PendingBroadcastWrite {
  chunks: ByteBatch | null;
  readonly promise: Promise<void>;
  readonly #deferred: Deferred<void>;
  #signal: StreamAbortSignal | null = null;
  #onAbort: (() => void) | null = null;

  constructor(chunks: ByteBatch) {
    this.chunks = chunks;
    this.#deferred = deferred<void>();
    this.promise = this.#deferred.promise;
  }

  wireSignal(signal: StreamAbortSignal, writer: BroadcastWriter): void {
    this.#signal = signal;
    this.#onAbort = (): void => {
      writer.removePending(this);
      this.chunks = null;
      this.#deferred.reject(signal.reason ?? new AbortError());
    };
    signal.addEventListener("abort", this.#onAbort, { once: true });
  }

  resolve(): void {
    this.#cleanupSignal();
    this.chunks = null;
    this.#deferred.resolve(undefined);
  }

  reject(reason?: unknown): void {
    this.#cleanupSignal();
    this.chunks = null;
    this.#deferred.reject(reason);
  }

  #cleanupSignal(): void {
    if (this.#signal !== null && this.#onAbort !== null) {
      this.#signal.removeEventListener("abort", this.#onAbort);
    }
    this.#signal = null;
    this.#onAbort = null;
  }
}

/** Writer half of a broadcast channel. */
export class BroadcastWriter {
  readonly #broadcast: BroadcastController;
  readonly #pendingWrites = new RingBuffer<PendingBroadcastWrite>();
  #pendingDrains: DrainWaiter[] = [];
  #totalBytes = 0;
  #closed: Promise<number> | null = null;
  #aborted = false;

  constructor(broadcast: BroadcastController) {
    this.#broadcast = broadcast;
    broadcast.setOnBufferDrained((): void => {
      this.#resolvePendingWrites();
      this.#resolvePendingDrains(true);
    });
  }

  [drainableProtocol](): Promise<boolean> | null {
    const canWrite = this.canWrite;
    if (canWrite === null) return null;
    if (canWrite) return Promise.resolve(true);
    const pending = deferred<boolean>();
    this.#pendingDrains.push(new DrainWaiter(pending.resolve, pending.reject));
    return pending.promise;
  }

  get canWrite(): boolean | null {
    return this.#closed !== null || this.#aborted ? null : this.#broadcast.canWrite();
  }

  write(chunk: string | Uint8Array, options?: WriterOptions): Promise<void> {
    const signal = getWriterSignal(options);
    if (signal === undefined && this.#canUseFastPath()) {
      const converted = toUint8Array(chunk);
      this.#broadcast.writeBatch([converted]);
      this.#totalBytes += converted.byteLength;
      return resolvedVoid;
    }
    return this.#writeSlow([chunk], signal);
  }

  writev(
    chunks: readonly (string | Uint8Array)[],
    options?: WriterOptions,
  ): Promise<void> {
    if (!Array.isArray(chunks)) {
      throw new ERR_INVALID_ARG_TYPE("chunks", "Array", chunks);
    }
    const signal = getWriterSignal(options);
    if (signal === undefined && this.#canUseFastPath()) {
      const converted = convertChunks(chunks);
      this.#broadcast.writeBatch(converted);
      this.#addWrittenBytes(converted);
      return resolvedVoid;
    }
    return this.#writeSlow(chunks, signal);
  }

  writeSync(chunk: string | Uint8Array): boolean {
    if (this.#closed !== null || this.#aborted || !this.#broadcast.canWrite()) return false;
    const converted = toUint8Array(chunk);
    if (!this.#broadcast.writeBatch([converted])) return false;
    this.#totalBytes += converted.byteLength;
    return true;
  }

  writevSync(chunks: readonly (string | Uint8Array)[]): boolean {
    if (!Array.isArray(chunks)) {
      throw new ERR_INVALID_ARG_TYPE("chunks", "Array", chunks);
    }
    if (this.#closed !== null || this.#aborted || !this.#broadcast.canWrite()) return false;
    const converted = convertChunks(chunks);
    if (!this.#broadcast.writeBatch(converted)) return false;
    this.#addWrittenBytes(converted);
    return true;
  }

  end(options?: WriterOptions): Promise<number> {
    const signal = getWriterSignal(options);
    if (signal !== undefined && signal.aborted) return Promise.reject(signal.reason);
    if (this.#closed !== null) return this.#closed;
    this.#closed = Promise.resolve(this.#totalBytes);
    this.#broadcast.end();
    this.#resolvePendingDrains(false);
    return this.#closed;
  }

  endSync(): number {
    if (this.#closed !== null) return this.#totalBytes;
    this.#closed = Promise.resolve(this.#totalBytes);
    this.#broadcast.end();
    this.#resolvePendingDrains(false);
    return this.#totalBytes;
  }

  fail(reason?: unknown): void {
    if (this.#closed !== null || this.#aborted) return;
    this.#aborted = true;
    this.#closed = Promise.resolve(this.#totalBytes);
    const error = reason ?? new ERR_INVALID_STATE_TYPE("Failed");
    this.#rejectPendingWrites(error);
    this.#rejectPendingDrains(error);
    this.#broadcast.abort(error);
  }

  [Symbol.asyncDispose](): Promise<void> {
    this.fail();
    return resolvedVoid;
  }

  [Symbol.dispose](): void {
    this.fail();
  }

  cancelPending(): void {
    if (this.#closed !== null) return;
    this.#closed = Promise.resolve(this.#totalBytes);
    this.#rejectPendingWrites(new AbortError("Broadcast cancelled"));
    this.#resolvePendingDrains(false);
  }

  removePending(entry: PendingBroadcastWrite): void {
    const index = this.#pendingWrites.indexOf(entry);
    if (index !== -1) this.#pendingWrites.removeAt(index);
  }

  #canUseFastPath(): boolean {
    return this.#closed === null && !this.#aborted && this.#broadcast.canWrite() === true;
  }

  async #writeSlow(
    chunks: readonly (string | Uint8Array)[],
    signal?: StreamAbortSignal,
  ): Promise<void> {
    if (signal !== undefined) throwIfAborted(signal);
    if (this.#closed !== null || this.#aborted) {
      throw new ERR_INVALID_STATE_TYPE("Writer is closed");
    }
    const converted = convertChunks(chunks);
    if (this.#broadcast.writeBatch(converted)) {
      this.#addWrittenBytes(converted);
      return;
    }
    if (
      this.#broadcast.backpressurePolicy === "strict" &&
      this.#pendingWrites.length >= 1
    ) {
      throw new ERR_INVALID_STATE_RANGE(
        "Backpressure violation: too many pending writes. " +
        "Await each write() call to respect backpressure.",
      );
    }
    const pending = new PendingBroadcastWrite(converted);
    this.#pendingWrites.push(pending);
    if (signal !== undefined) pending.wireSignal(signal, this);
    return pending.promise;
  }

  #resolvePendingWrites(): void {
    while (this.#pendingWrites.length > 0 && this.#broadcast.canWrite()) {
      const pending = this.#pendingWrites.shift();
      if (pending === undefined) continue;
      const chunks = pending.chunks;
      if (chunks !== null && this.#broadcast.writeBatch(chunks)) {
        this.#addWrittenBytes(chunks);
        pending.resolve();
      } else {
        this.#pendingWrites.unshift(pending);
        break;
      }
    }
  }

  #rejectPendingWrites(error: unknown): void {
    while (this.#pendingWrites.length > 0) this.#pendingWrites.shift()?.reject(error);
  }

  #resolvePendingDrains(canWrite: boolean): void {
    const drains = this.#pendingDrains;
    this.#pendingDrains = [];
    for (let i = 0; i < drains.length; i++) drains[i]?.resolve(canWrite);
  }

  #rejectPendingDrains(error: unknown): void {
    const drains = this.#pendingDrains;
    this.#pendingDrains = [];
    for (let i = 0; i < drains.length; i++) drains[i]?.reject(error);
  }

  #addWrittenBytes(chunks: ByteBatch): void {
    this.#totalBytes += batchByteSize(chunks);
  }
}

export interface BroadcastLike {
  readonly consumerCount: number;
  push(...args: unknown[]): AsyncByteStream;
  cancel(reason?: unknown): void;
}

class ProtocolWriterPlaceholder {}

export interface BroadcastPair<
  Writer extends object = BroadcastWriter,
  Channel extends object = BroadcastController,
> {
  readonly writer: Writer;
  readonly broadcast: Channel;
}

/** Create an empty push-model broadcast channel. */
export function broadcast(
  options: unknown = {},
): BroadcastPair<BroadcastWriter, BroadcastController> {
  const parsed = parseOptions(options);
  const controller = new BroadcastController(parsed);
  const writer = new BroadcastWriter(controller);
  controller.setWriter(writer);
  if (parsed.signal !== undefined) {
    const signal = parsed.signal;
    const cancel = (): void => controller.cancel(signal.reason);
    if (signal.aborted) cancel();
    else signal.addEventListener("abort", cancel, { once: true });
  }
  return { writer, broadcast: controller };
}

async function pumpBroadcast(
  source: AsyncByteStream,
  writer: BroadcastWriter,
  signal?: StreamAbortSignal,
): Promise<void> {
  try {
    for await (const chunks of source) {
      if (signal !== undefined) throwIfAborted(signal);
      if (!writer.writevSync(chunks)) {
        await writer.writev(chunks, signal === undefined ? undefined : { signal });
      }
    }
    writer.endSync();
  } catch (error) {
    writer.fail(wrapError(error));
  }
}

export interface BroadcastProtocolSource<Result extends object> {
  [broadcastProtocol](options?: unknown): Result;
}

function broadcastFrom<Result extends object>(
  input: BroadcastProtocolSource<Result>,
  options?: unknown,
): BroadcastPair<ProtocolWriterPlaceholder, Result>;
function broadcastFrom(
  input: unknown,
  options?: unknown,
): BroadcastPair<BroadcastWriter, BroadcastController>;
function broadcastFrom(
  input: unknown,
  options?: unknown,
): BroadcastPair<object, object> {
  if (hasBroadcastProtocol(input)) {
    const result = input[broadcastProtocol](options);
    if (result === null || typeof result !== "object") {
      throw new ERR_INVALID_RETURN_VALUE(
        "an object",
        "[Symbol.for('Stream.broadcastProtocol')]",
        result,
      );
    }
    return { writer: new ProtocolWriterPlaceholder(), broadcast: result };
  }

  const source = from(input);
  const result = broadcast(options);
  const signal = options !== null && typeof options === "object" && "signal" in options
    ? options.signal
    : undefined;
  validateSignal(signal);
  void pumpBroadcast(source, result.writer, signal).catch((): void => {});
  return result;
}

export const Broadcast = {
  from: broadcastFrom,
};
