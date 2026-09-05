// Bonded push writer/readable pair from Node v24.20.0
// `lib/internal/streams/iter/push.js`.

import {
  AbortError,
  ERR_INVALID_ARG_TYPE,
  ERR_INVALID_STATE,
  ERR_INVALID_STATE_RANGE,
  ERR_INVALID_STATE_TYPE,
} from "../../../internal/errors.ts";
import { validateInteger } from "../../../internal/validators.ts";
import { pull, type PullOptions } from "./pull.ts";
import { RingBuffer } from "./ring-buffer.ts";
import { drainableProtocol } from "./types.ts";
import {
  type BackpressurePolicy,
  type AsyncByteStream,
  type ByteBatch,
  convertChunks,
  getWriterSignal,
  type StreamAbortSignal,
  throwIfAborted,
  toUint8Array,
  validateBackpressure,
  type WriterOptions,
} from "./utils.ts";

const DEFAULT_BUDGET = 16_384;
const kNoFailReason = Symbol("kNoFailReason");
const resolvedVoid = Promise.resolve();

type WriterState = "open" | "closing" | "closed" | "errored";
type ConsumerState = "active" | "returned" | "thrown";

export interface PushOptions extends PullOptions {
  budget?: number;
  backpressure?: BackpressurePolicy;
}

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

interface PendingWrite extends Deferred<void> {
  readonly chunks: ByteBatch;
}

class PushQueue {
  readonly #slots = new RingBuffer<ByteBatch>();
  readonly #pendingWrites = new RingBuffer<PendingWrite>();
  readonly #pendingReads = new RingBuffer<Deferred<IteratorResult<ByteBatch>>>();
  #pendingDrains = new RingBuffer<Deferred<boolean>>();
  #writerState: WriterState = "open";
  #consumerState: ConsumerState = "active";
  #error: unknown = null;
  #bytesWritten = 0;
  #pendingEnd: Deferred<number> | null = null;
  readonly #budget: number;
  readonly #backpressure: BackpressurePolicy;
  readonly #signal?: StreamAbortSignal;
  #abortHandler?: () => void;
  #bufferedBytes = 0;

  constructor(options: PushOptions) {
    const budget = options.budget ?? DEFAULT_BUDGET;
    validateInteger(budget, "options.budget", DEFAULT_BUDGET);
    const backpressure = options.backpressure ?? "strict";
    validateBackpressure(backpressure);
    getWriterSignal(options);
    this.#budget = budget;
    this.#backpressure = backpressure;
    this.#signal = options.signal;

    if (this.#signal !== undefined) {
      this.#abortHandler = (): void => this.fail(this.#signal?.reason);
      if (this.#signal.aborted) this.#abortHandler();
      else this.#signal.addEventListener("abort", this.#abortHandler, { once: true });
    }
  }

  get canWrite(): boolean | null {
    if (this.#writerState !== "open" || this.#consumerState !== "active") return null;
    if (
      (this.#backpressure === "strict" || this.#backpressure === "unbounded") &&
      this.#bufferedBytes >= this.#budget
    ) return false;
    return true;
  }

  canWriteSync(): boolean {
    return this.#writerState === "open" &&
      this.#consumerState === "active" &&
      this.#bufferedBytes < this.#budget;
  }

  writeSync(chunks: ByteBatch): boolean {
    if (this.#writerState !== "open" || this.#consumerState !== "active") return false;
    const size = this.#batchByteSize(chunks);
    if (size === 0) return true;

    if (this.#bufferedBytes >= this.#budget) {
      if (this.#backpressure === "strict" || this.#backpressure === "unbounded") return false;
      if (this.#backpressure === "drop-newest") {
        this.#bytesWritten += size;
        return true;
      }
      while (this.#bufferedBytes >= this.#budget && this.#slots.length > 0) {
        const evicted = this.#slots.shift();
        if (evicted !== undefined) this.#bufferedBytes -= this.#batchByteSize(evicted);
      }
    }

    this.#slots.push(chunks);
    this.#bufferedBytes += size;
    this.#bytesWritten += size;
    this.#resolvePendingReads();
    if (this.#bufferedBytes < this.#budget) this.#resolvePendingDrains(true);
    return true;
  }

  async write(chunks: ByteBatch, signal?: StreamAbortSignal): Promise<void> {
    if (this.#writerState === "closed") throw new ERR_INVALID_STATE_TYPE("Writer is closed");
    if (this.#writerState === "closing") throw new ERR_INVALID_STATE_TYPE("Writer is closing");
    if (this.#writerState === "errored") throw this.#error;
    if (this.#consumerState !== "active") {
      if (this.#consumerState === "thrown" && this.#error !== null) throw this.#error;
      throw new ERR_INVALID_STATE_TYPE("Stream closed by consumer");
    }
    if (signal !== undefined) throwIfAborted(signal);
    if (this.writeSync(chunks)) return;

    if (this.#backpressure === "strict" && this.#pendingWrites.length >= 1) {
      throw new ERR_INVALID_STATE_RANGE(
        "Backpressure violation: too many pending writes. " +
        "Await each write() call to respect backpressure.",
      );
    }
    if (this.#backpressure !== "strict" && this.#backpressure !== "unbounded") {
      throw new ERR_INVALID_STATE("Unexpected: writeSync should have handled non-strict policy");
    }
    await this.#createPendingWrite(chunks, signal);
  }

  #createPendingWrite(chunks: ByteBatch, signal?: StreamAbortSignal): Promise<void> {
    const pending = deferred<void>();
    const entry: PendingWrite = {
      chunks,
      promise: pending.promise,
      resolve: pending.resolve,
      reject: pending.reject,
    };
    this.#pendingWrites.push(entry);

    if (signal !== undefined) {
      const resolve = entry.resolve;
      const reject = entry.reject;
      const onAbort = (): void => {
        const index = this.#pendingWrites.indexOf(entry);
        if (index !== -1) this.#pendingWrites.removeAt(index);
        reject(signal.reason ?? new AbortError());
      };
      entry.resolve = (): void => {
        signal.removeEventListener("abort", onAbort);
        resolve(undefined);
      };
      entry.reject = (reason?: unknown): void => {
        signal.removeEventListener("abort", onAbort);
        reject(reason);
      };
      signal.addEventListener("abort", onAbort, { once: true });
      if (signal.aborted) onAbort();
    }
    return entry.promise;
  }

  end(): number {
    if (this.#writerState === "errored") return -2;
    if (this.#writerState === "closing") return -3;
    if (this.#writerState === "closed") return this.#bytesWritten;

    this.#cleanup();
    this.#rejectPendingWrites(new ERR_INVALID_STATE_TYPE("Writer closed"));
    this.#resolvePendingDrains(false);
    if (this.#slots.length === 0) {
      this.#writerState = "closed";
      this.#resolvePendingReads();
      return this.#bytesWritten;
    }
    this.#writerState = "closing";
    return -3;
  }

  endDrained(): void {
    if (this.#writerState !== "closing") return;
    this.#writerState = "closed";
    this.#pendingEnd?.resolve(this.#bytesWritten);
    this.#pendingEnd = null;
  }

  fail(reason: unknown = kNoFailReason): void {
    if (this.#writerState === "errored" || this.#writerState === "closed") return;
    const wasClosing = this.#writerState === "closing";
    this.#writerState = "errored";
    this.#error = reason === kNoFailReason ? new ERR_INVALID_STATE("Failed") : reason;
    this.#cleanup();
    this.#rejectPendingReads(this.#error);
    this.#rejectPendingDrains(this.#error);
    if (wasClosing) {
      this.#pendingEnd?.reject(this.#error);
      this.#pendingEnd = null;
    } else {
      this.#rejectPendingWrites(this.#error);
    }
  }

  get totalBytesWritten(): number { return this.#bytesWritten; }
  get error(): unknown { return this.#error; }
  get writerState(): WriterState { return this.#writerState; }
  get pendingEndPromise(): Promise<number> | null { return this.#pendingEnd?.promise ?? null; }
  setPendingEnd(pending: Deferred<number>): void { this.#pendingEnd = pending; }

  waitForDrain(): Promise<boolean> {
    const pending = deferred<boolean>();
    this.#pendingDrains.push(pending);
    return pending.promise;
  }

  read(): Promise<IteratorResult<ByteBatch>> {
    if (this.#slots.length > 0) {
      const value = this.#drain();
      this.#resolvePendingWrites();
      if (this.#writerState === "closing" && this.#slots.length === 0) this.endDrained();
      return Promise.resolve({ value, done: false });
    }
    if (this.#writerState === "closing") {
      this.endDrained();
      return Promise.resolve({ value: undefined, done: true });
    }
    if (this.#writerState === "closed") {
      return Promise.resolve({ value: undefined, done: true });
    }
    if (this.#writerState === "errored") return Promise.reject(this.#error);
    const pending = deferred<IteratorResult<ByteBatch>>();
    this.#pendingReads.push(pending);
    return pending.promise;
  }

  consumerReturn(): void {
    if (this.#consumerState !== "active") return;
    this.#consumerState = "returned";
    this.#cleanup();
    this.#resolvePendingReads();
    this.#rejectPendingWrites(new ERR_INVALID_STATE_TYPE("Stream closed by consumer"));
    if (this.#writerState === "closing") {
      this.#pendingEnd?.reject(new ERR_INVALID_STATE_TYPE("Stream closed by consumer"));
      this.#pendingEnd = null;
    }
    this.#resolvePendingDrains(false);
  }

  consumerThrow(error: unknown): void {
    if (this.#consumerState !== "active") return;
    this.#consumerState = "thrown";
    this.#error = error;
    this.#cleanup();
    this.#rejectPendingReads(error);
    this.#rejectPendingWrites(error);
    if (this.#writerState === "closing") {
      this.#pendingEnd?.reject(error);
      this.#pendingEnd = null;
    }
    this.#rejectPendingDrains(error);
  }

  #drain(): ByteBatch {
    this.#bufferedBytes = 0;
    if (this.#slots.length === 1) return this.#slots.shift() ?? [];
    const result: ByteBatch = [];
    for (let i = 0; i < this.#slots.length; i++) {
      const slot = this.#slots.get(i);
      if (slot === undefined) continue;
      for (let j = 0; j < slot.length; j++) {
        const chunk = slot[j];
        if (chunk !== undefined) result.push(chunk);
      }
    }
    this.#slots.clear();
    return result;
  }

  #batchByteSize(batch: ByteBatch): number {
    let size = 0;
    for (let i = 0; i < batch.length; i++) size += batch[i]?.byteLength ?? 0;
    return size;
  }

  #resolvePendingReads(): void {
    while (this.#pendingReads.length > 0) {
      const pending = this.#pendingReads.shift();
      if (pending === undefined) continue;
      if (this.#slots.length > 0) {
        const value = this.#drain();
        this.#resolvePendingWrites();
        pending.resolve({ value, done: false });
      } else if (this.#writerState === "closing") {
        this.endDrained();
        pending.resolve({ value: undefined, done: true });
      } else if (this.#writerState === "closed" || this.#consumerState === "returned") {
        pending.resolve({ value: undefined, done: true });
      } else if (this.#writerState === "errored") {
        pending.reject(this.#error);
      } else {
        this.#pendingReads.push(pending);
        break;
      }
    }
  }

  #resolvePendingWrites(): void {
    while (this.#pendingWrites.length > 0 && this.#bufferedBytes < this.#budget) {
      const pending = this.#pendingWrites.shift();
      if (pending === undefined) continue;
      this.#slots.push(pending.chunks);
      const size = this.#batchByteSize(pending.chunks);
      this.#bufferedBytes += size;
      this.#bytesWritten += size;
      pending.resolve(undefined);
    }
    if (this.#bufferedBytes < this.#budget) this.#resolvePendingDrains(true);
  }

  #resolvePendingDrains(canWrite: boolean): void {
    const drains = this.#pendingDrains;
    this.#pendingDrains = new RingBuffer<Deferred<boolean>>();
    while (drains.length > 0) drains.shift()?.resolve(canWrite);
  }

  #rejectPendingDrains(error: unknown): void {
    const drains = this.#pendingDrains;
    this.#pendingDrains = new RingBuffer<Deferred<boolean>>();
    while (drains.length > 0) drains.shift()?.reject(error);
  }

  #rejectPendingReads(error: unknown): void {
    while (this.#pendingReads.length > 0) this.#pendingReads.shift()?.reject(error);
  }

  #rejectPendingWrites(error: unknown): void {
    while (this.#pendingWrites.length > 0) this.#pendingWrites.shift()?.reject(error);
  }

  #cleanup(): void {
    if (this.#signal !== undefined && this.#abortHandler !== undefined) {
      this.#signal.removeEventListener("abort", this.#abortHandler);
      this.#abortHandler = undefined;
    }
  }
}

export class PushWriter {
  readonly #queue: PushQueue;
  constructor(queue: PushQueue) {
    this.#queue = queue;
  }

  [drainableProtocol](): Promise<boolean> | null {
    const canWrite = this.canWrite;
    if (canWrite === null) return null;
    return canWrite ? Promise.resolve(true) : this.#queue.waitForDrain();
  }

  get canWrite(): boolean | null { return this.#queue.canWrite; }

  write(chunk: string | Uint8Array, options?: WriterOptions): Promise<void> {
    const signal = getWriterSignal(options);
    if (signal === undefined && this.#queue.canWriteSync()) {
      this.#queue.writeSync([toUint8Array(chunk)]);
      return resolvedVoid;
    }
    return this.#queue.write([toUint8Array(chunk)], signal);
  }

  writev(chunks: readonly (string | Uint8Array)[], options?: WriterOptions): Promise<void> {
    if (!Array.isArray(chunks)) {
      throw new ERR_INVALID_ARG_TYPE("chunks", "Array", chunks);
    }
    const signal = getWriterSignal(options);
    const converted = convertChunks(chunks);
    if (signal === undefined && this.#queue.canWriteSync()) {
      this.#queue.writeSync(converted);
      return resolvedVoid;
    }
    return this.#queue.write(converted, signal);
  }

  writeSync(chunk: string | Uint8Array): boolean {
    return this.#queue.writeSync([toUint8Array(chunk)]);
  }

  writevSync(chunks: readonly (string | Uint8Array)[]): boolean {
    if (!Array.isArray(chunks)) {
      throw new ERR_INVALID_ARG_TYPE("chunks", "Array", chunks);
    }
    return this.#queue.writeSync(convertChunks(chunks));
  }

  end(options?: WriterOptions): Promise<number> {
    const signal = getWriterSignal(options);
    if (signal?.aborted) return Promise.reject(signal.reason);
    const result = this.#queue.end();
    if (result === -2) return Promise.reject(this.#queue.error);
    if (result !== -3) return Promise.resolve(result);

    let pending = this.#queue.pendingEndPromise;
    if (pending === null) {
      const created = deferred<number>();
      this.#queue.setPendingEnd(created);
      pending = created.promise;
    }
    if (signal === undefined) return pending;

    return this.#waitForEnd(pending, signal);
  }

  async #waitForEnd(
    pending: Promise<number>,
    signal: StreamAbortSignal,
  ): Promise<number> {
    const aborted = deferred<number>();
    const onAbort = (): void => aborted.reject(signal.reason ?? new AbortError());
    signal.addEventListener("abort", onAbort, { once: true });
    try {
      return await Promise.race([pending, aborted.promise]);
    } finally {
      signal.removeEventListener("abort", onAbort);
    }
  }

  endSync(): number {
    const result = this.#queue.end();
    return result === -2 || result === -3 ? -1 : result;
  }

  fail(...reasons: unknown[]): void {
    this.#queue.fail(reasons.length === 0 ? kNoFailReason : reasons[0]);
  }

  async [Symbol.asyncDispose](): Promise<void> {
    const state = this.#queue.writerState;
    if (state === "closing") {
      await (this.#queue.pendingEndPromise ?? resolvedVoid);
      return;
    }
    if (state === "open") this.fail();
  }

  [Symbol.dispose](): void {
    this.fail();
  }
}

class PushIterator implements AsyncIterator<ByteBatch> {
  readonly #queue: PushQueue;
  constructor(queue: PushQueue) {
    this.#queue = queue;
  }
  next(): Promise<IteratorResult<ByteBatch>> {
    return this.#queue.read();
  }
  async return(): Promise<IteratorResult<ByteBatch>> {
    this.#queue.consumerReturn();
    return { value: undefined, done: true };
  }
  async throw(error?: unknown): Promise<IteratorResult<ByteBatch>> {
    this.#queue.consumerThrow(error);
    throw error;
  }
}

class PushReadable implements AsyncByteStream {
  readonly #queue: PushQueue;
  constructor(queue: PushQueue) {
    this.#queue = queue;
  }
  [Symbol.asyncIterator](): AsyncIterator<ByteBatch> {
    return new PushIterator(this.#queue);
  }
}

export interface PushPair {
  readonly writer: PushWriter;
  readonly readable: AsyncByteStream;
}

function isPushOptions(value: unknown): value is PushOptions {
  return value !== null &&
    typeof value === "object" &&
    !("transform" in value) &&
    !("write" in value);
}

export function push(...args: unknown[]): PushPair {
  let count = args.length;
  let options: PushOptions = {};
  const last = args[count - 1];
  if (isPushOptions(last)) {
    options = last;
    count--;
  }
  const transforms: unknown[] = [];
  for (let i = 0; i < count; i++) transforms.push(args[i]);

  const queue = new PushQueue(options);
  const writer = new PushWriter(queue);
  const rawReadable = new PushReadable(queue);
  const readable = transforms.length === 0
    ? rawReadable
    : options.signal === undefined
      ? pull(rawReadable, ...transforms)
      : pull(rawReadable, ...transforms, { signal: options.signal });
  return { writer, readable };
}
