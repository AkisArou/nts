// Pull-model multi-consumer byte streaming from Node v24.20.0
// `lib/internal/streams/iter/share.js`.

import {
  ERR_INVALID_ARG_TYPE,
  ERR_INVALID_RETURN_VALUE,
  ERR_OUT_OF_RANGE,
} from "../../../internal/errors.ts";
import {
  validateInteger,
  validateObject,
} from "../../../internal/validators.ts";
import { from, fromSync } from "./from.ts";
import { pull, pullSync } from "./pull.ts";
import { RingBuffer } from "./ring-buffer.ts";
import {
  hasShareProtocol,
  hasShareSyncProtocol,
  shareProtocol,
  shareSyncProtocol,
} from "./types.ts";
import {
  type AsyncByteStream,
  type BackpressurePolicy,
  type ByteBatch,
  isAsyncIterable,
  isSyncIterable,
  type StreamAbortSignal,
  type SyncByteStream,
  validateBackpressure,
  wrapError,
} from "./utils.ts";

const DEFAULT_BUDGET = 65_536;
const MINIMUM_BUDGET = 16_384;
const resolvedVoid = Promise.resolve();
const doneResult: IteratorResult<ByteBatch> = { value: undefined, done: true };
const donePromise = Promise.resolve(doneResult);

interface DeferredVoid {
  readonly promise: Promise<void>;
  resolve(): void;
}

function deferredVoid(): DeferredVoid {
  let resolve: () => void = (): void => {};
  const promise = new Promise<void>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

interface ParsedShareOptions {
  readonly budget: number;
  readonly backpressure: BackpressurePolicy;
  readonly signal?: StreamAbortSignal;
}

function validateSignal(
  signal: unknown,
): asserts signal is StreamAbortSignal | undefined {
  if (
    signal !== undefined &&
    (signal === null || typeof signal !== "object" || !(
      "aborted" in signal &&
      "addEventListener" in signal &&
      typeof signal.addEventListener === "function" &&
      "removeEventListener" in signal &&
      typeof signal.removeEventListener === "function"
    ))
  ) {
    throw new ERR_INVALID_ARG_TYPE("options.signal", "AbortSignal", signal);
  }
}

function parseOptions(options: unknown, allowSignal: boolean): ParsedShareOptions {
  validateObject(options, "options");
  const budget = "budget" in options && options.budget !== undefined
    ? options.budget
    : DEFAULT_BUDGET;
  validateInteger(budget, "options.budget", MINIMUM_BUDGET);
  const backpressure = "backpressure" in options && options.backpressure !== undefined
    ? options.backpressure
    : "strict";
  validateBackpressure(backpressure);

  if (!allowSignal) return { budget, backpressure };
  const signal = "signal" in options ? options.signal : undefined;
  validateSignal(signal);
  return { budget, backpressure, signal };
}

function batchByteSize(batch: ByteBatch): number {
  let size = 0;
  for (let i = 0; i < batch.length; i++) size += batch[i]?.byteLength ?? 0;
  return size;
}

class AsyncConsumerState {
  cursor: number;
  detached = false;
  pendingNext: Promise<void> = resolvedVoid;

  constructor(cursor: number) {
    this.cursor = cursor;
  }
}

class AsyncShareIterator implements AsyncIterator<ByteBatch> {
  readonly #share: AsyncShareController;
  readonly #state: AsyncConsumerState;

  constructor(share: AsyncShareController, state: AsyncConsumerState) {
    this.#share = share;
    this.#state = state;
  }

  next(): Promise<IteratorResult<ByteBatch>> {
    const next = this.#state.pendingNext.then(
      (): Promise<IteratorResult<ByteBatch>> => this.#share.read(this.#state),
      (): Promise<IteratorResult<ByteBatch>> => this.#share.read(this.#state),
    );
    this.#state.pendingNext = next.then(
      (): void => {},
      (): void => {},
    );
    return next;
  }

  return(): Promise<IteratorResult<ByteBatch>> {
    this.#share.detach(this.#state);
    return donePromise;
  }

  throw(_error?: unknown): Promise<IteratorResult<ByteBatch>> {
    this.#share.detach(this.#state);
    return donePromise;
  }
}

class AsyncShareConsumer implements AsyncByteStream {
  readonly #share: AsyncShareController;
  readonly #state: AsyncConsumerState;

  constructor(share: AsyncShareController, state: AsyncConsumerState) {
    this.#share = share;
    this.#state = state;
  }

  [Symbol.asyncIterator](): AsyncIterator<ByteBatch> {
    return new AsyncShareIterator(this.#share, this.#state);
  }
}

/** A single async source shared by independently advancing consumers. */
export class AsyncShareController {
  readonly #source: AsyncByteStream;
  readonly #options: ParsedShareOptions;
  readonly #buffer = new RingBuffer<ByteBatch>();
  readonly #consumers = new Set<AsyncConsumerState>();
  readonly #pullWaiters = new RingBuffer<DeferredVoid>();
  #sourceIterator: AsyncIterator<ByteBatch> | null = null;
  #bufferStart = 0;
  #bufferedBytes = 0;
  #cachedMinCursor = 0;
  #cachedMinCursorConsumers = 0;
  #sourceExhausted = false;
  #hasSourceError = false;
  #sourceError: unknown;
  #cancelled = false;
  #pulling = false;

  constructor(source: AsyncByteStream, options: ParsedShareOptions) {
    this.#source = source;
    this.#options = options;
  }

  get consumerCount(): number {
    return this.#consumers.size;
  }

  pull(...args: unknown[]): AsyncByteStream {
    const state = this.#createConsumerState();
    const raw = new AsyncShareConsumer(this, state);
    if (args.length === 0) return raw;
    try {
      return pull(raw, ...args);
    } catch (error) {
      this.detach(state);
      throw error;
    }
  }

  async read(state: AsyncConsumerState): Promise<IteratorResult<ByteBatch>> {
    if (this.#hasSourceError) {
      this.#detachAfterTerminalState(state);
      throw this.#sourceError;
    }

    while (true) {
      if (state.detached) return doneResult;
      if (this.#cancelled) {
        this.#detachAfterTerminalState(state);
        return doneResult;
      }

      const index = state.cursor - this.#bufferStart;
      if (index < this.#buffer.length) {
        return { value: this.#consumeBuffered(state, index), done: false };
      }

      if (this.#sourceExhausted) {
        this.#detachAfterTerminalState(state);
        if (this.#hasSourceError) throw this.#sourceError;
        return doneResult;
      }

      const shouldBuffer = await this.#waitForBufferSpace();
      if (shouldBuffer === null) {
        this.#detachAfterTerminalState(state);
        if (this.#hasSourceError) throw this.#sourceError;
        return doneResult;
      }
      await this.#pullFromSource(!shouldBuffer);

      if (this.#hasSourceError) {
        this.#detachAfterTerminalState(state);
        throw this.#sourceError;
      }
    }
  }

  detach(state: AsyncConsumerState): void {
    if (state.detached) return;
    state.detached = true;
    if (this.#deleteConsumer(state)) this.#tryTrimBuffer();
  }

  cancel(reason?: unknown): void {
    if (this.#cancelled) return;
    this.#cancelled = true;
    if (reason !== undefined) {
      this.#hasSourceError = true;
      this.#sourceError = reason;
    }

    const iterator = this.#sourceIterator;
    if (iterator?.return !== undefined) {
      try {
        void Promise.resolve(iterator.return()).catch((): void => {});
      } catch {
        // Cancellation is already terminal; source cleanup cannot replace it.
      }
    }

    for (const consumer of this.#consumers) consumer.detached = true;
    this.#consumers.clear();
    this.#cachedMinCursorConsumers = 0;
    this.#wakePullWaiters();
  }

  [Symbol.dispose](): void {
    this.cancel();
  }

  #createConsumerState(): AsyncConsumerState {
    const state = new AsyncConsumerState(this.#bufferStart);
    this.#consumers.add(state);
    if (this.#consumers.size === 1) {
      this.#cachedMinCursor = state.cursor;
      this.#cachedMinCursorConsumers = 1;
    } else if (state.cursor === this.#cachedMinCursor) {
      this.#cachedMinCursorConsumers++;
    } else {
      this.#recomputeMinCursor();
    }
    return state;
  }

  async #waitForBufferSpace(): Promise<boolean | null> {
    while (this.#bufferedBytes >= this.#options.budget) {
      if (this.#cancelled || this.#hasSourceError || this.#sourceExhausted) {
        return this.#cancelled ? null : true;
      }

      switch (this.#options.backpressure) {
        case "strict":
          throw new ERR_OUT_OF_RANGE(
            "buffered bytes",
            `< ${this.#options.budget}`,
            this.#bufferedBytes,
          );
        case "unbounded": {
          const waiter = deferredVoid();
          this.#pullWaiters.push(waiter);
          await waiter.promise;
          break;
        }
        case "drop-oldest":
          this.#dropOldest();
          return true;
        case "drop-newest":
          return false;
      }
    }
    return true;
  }

  async #pullFromSource(discard: boolean): Promise<void> {
    if (this.#sourceExhausted || this.#cancelled) return;
    if (this.#pulling) {
      const waiter = deferredVoid();
      this.#pullWaiters.push(waiter);
      await waiter.promise;
      return;
    }

    this.#pulling = true;
    try {
      if (this.#sourceIterator === null) {
        this.#sourceIterator = this.#source[Symbol.asyncIterator]();
      }
      const result = await this.#sourceIterator.next();
      if (result.done) {
        this.#sourceExhausted = true;
      } else if (!discard) {
        this.#buffer.push(result.value);
        this.#bufferedBytes += batchByteSize(result.value);
      }
    } catch (error) {
      this.#hasSourceError = true;
      this.#sourceError = wrapError(error);
      this.#sourceExhausted = true;
    } finally {
      this.#pulling = false;
      this.#wakePullWaiters();
    }
  }

  #consumeBuffered(state: AsyncConsumerState, index: number): ByteBatch {
    const batch = this.#buffer.get(index);
    if (batch === undefined) throw new Error("share buffer cursor is out of range");
    const cursor = state.cursor;
    state.cursor++;
    if (
      cursor === this.#cachedMinCursor &&
      --this.#cachedMinCursorConsumers === 0
    ) this.#tryTrimBuffer();
    return batch;
  }

  #dropOldest(): void {
    while (
      this.#bufferedBytes >= this.#options.budget &&
      this.#buffer.length > 0
    ) {
      const removed = this.#buffer.shift();
      if (removed !== undefined) this.#bufferedBytes -= batchByteSize(removed);
      this.#bufferStart++;
    }
    for (const consumer of this.#consumers) {
      if (consumer.cursor < this.#bufferStart) consumer.cursor = this.#bufferStart;
    }
    this.#recomputeMinCursor();
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
    this.#wakePullWaiters();
  }

  #detachAfterTerminalState(state: AsyncConsumerState): void {
    if (state.detached) return;
    state.detached = true;
    if (this.#deleteConsumer(state)) this.#tryTrimBuffer();
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

  #deleteConsumer(state: AsyncConsumerState): boolean {
    if (!this.#consumers.delete(state)) return false;
    if (state.cursor !== this.#cachedMinCursor) return false;
    this.#cachedMinCursorConsumers--;
    return this.#cachedMinCursorConsumers === 0;
  }

  #wakePullWaiters(): void {
    while (this.#pullWaiters.length > 0) this.#pullWaiters.shift()?.resolve();
  }
}

class SyncConsumerState {
  cursor: number;
  detached = false;

  constructor(cursor: number) {
    this.cursor = cursor;
  }
}

class SyncShareIterator implements Iterator<ByteBatch> {
  readonly #share: SyncShareController;
  readonly #state: SyncConsumerState;

  constructor(share: SyncShareController, state: SyncConsumerState) {
    this.#share = share;
    this.#state = state;
  }

  next(): IteratorResult<ByteBatch> {
    return this.#share.read(this.#state);
  }

  return(): IteratorResult<ByteBatch> {
    this.#share.detach(this.#state);
    return doneResult;
  }

  throw(_error?: unknown): IteratorResult<ByteBatch> {
    this.#share.detach(this.#state);
    return doneResult;
  }
}

class SyncShareConsumer implements SyncByteStream {
  readonly #share: SyncShareController;
  readonly #state: SyncConsumerState;

  constructor(share: SyncShareController, state: SyncConsumerState) {
    this.#share = share;
    this.#state = state;
  }

  [Symbol.iterator](): Iterator<ByteBatch> {
    return new SyncShareIterator(this.#share, this.#state);
  }
}

/** A single synchronous source shared by independently advancing consumers. */
export class SyncShareController {
  readonly #source: SyncByteStream;
  readonly #options: ParsedShareOptions;
  readonly #buffer = new RingBuffer<ByteBatch>();
  readonly #consumers = new Set<SyncConsumerState>();
  #sourceIterator: Iterator<ByteBatch> | null = null;
  #bufferStart = 0;
  #bufferedBytes = 0;
  #cachedMinCursor = 0;
  #cachedMinCursorConsumers = 0;
  #sourceExhausted = false;
  #hasSourceError = false;
  #sourceError: unknown;
  #cancelled = false;

  constructor(source: SyncByteStream, options: ParsedShareOptions) {
    this.#source = source;
    this.#options = options;
  }

  get consumerCount(): number {
    return this.#consumers.size;
  }

  pull(...args: unknown[]): SyncByteStream {
    const state = this.#createConsumerState();
    const raw = new SyncShareConsumer(this, state);
    if (args.length === 0) return raw;
    try {
      return pullSync(raw, ...args);
    } catch (error) {
      this.detach(state);
      throw error;
    }
  }

  read(state: SyncConsumerState): IteratorResult<ByteBatch> {
    if (state.detached) return doneResult;
    if (this.#hasSourceError) {
      this.#detachAfterTerminalState(state);
      throw this.#sourceError;
    }
    if (this.#cancelled) {
      this.#detachAfterTerminalState(state);
      return doneResult;
    }

    let index = state.cursor - this.#bufferStart;
    if (index < this.#buffer.length) {
      return { value: this.#consumeBuffered(state, index), done: false };
    }
    if (this.#sourceExhausted) {
      this.#detachAfterTerminalState(state);
      return doneResult;
    }

    if (this.#bufferedBytes >= this.#options.budget) {
      switch (this.#options.backpressure) {
        case "strict":
          throw this.#backpressureError("");
        case "unbounded":
          throw this.#backpressureError(" (unbounded not available in sync context)");
        case "drop-oldest":
          this.#dropOldest();
          break;
        case "drop-newest":
          this.#detachAfterTerminalState(state);
          return doneResult;
      }
    }

    this.#pullFromSource();
    if (this.#hasSourceError) {
      this.#detachAfterTerminalState(state);
      throw this.#sourceError;
    }

    index = state.cursor - this.#bufferStart;
    if (index < this.#buffer.length) {
      return { value: this.#consumeBuffered(state, index), done: false };
    }
    if (this.#sourceExhausted) this.#detachAfterTerminalState(state);
    return doneResult;
  }

  detach(state: SyncConsumerState): void {
    if (state.detached) return;
    state.detached = true;
    if (this.#deleteConsumer(state)) this.#tryTrimBuffer();
  }

  cancel(reason?: unknown): void {
    if (this.#cancelled) return;
    this.#cancelled = true;
    if (reason !== undefined) {
      this.#hasSourceError = true;
      this.#sourceError = reason;
    }
    if (this.#sourceIterator?.return !== undefined) this.#sourceIterator.return();
    for (const consumer of this.#consumers) consumer.detached = true;
    this.#consumers.clear();
    this.#cachedMinCursorConsumers = 0;
  }

  [Symbol.dispose](): void {
    this.cancel();
  }

  #createConsumerState(): SyncConsumerState {
    const state = new SyncConsumerState(this.#bufferStart);
    this.#consumers.add(state);
    if (this.#consumers.size === 1) {
      this.#cachedMinCursor = state.cursor;
      this.#cachedMinCursorConsumers = 1;
    } else if (state.cursor === this.#cachedMinCursor) {
      this.#cachedMinCursorConsumers++;
    } else {
      this.#recomputeMinCursor();
    }
    return state;
  }

  #pullFromSource(): void {
    if (this.#sourceExhausted || this.#cancelled) return;
    try {
      if (this.#sourceIterator === null) {
        this.#sourceIterator = this.#source[Symbol.iterator]();
      }
      const result = this.#sourceIterator.next();
      if (result.done) {
        this.#sourceExhausted = true;
      } else {
        this.#buffer.push(result.value);
        this.#bufferedBytes += batchByteSize(result.value);
      }
    } catch (error) {
      this.#hasSourceError = true;
      this.#sourceError = wrapError(error);
      this.#sourceExhausted = true;
    }
  }

  #consumeBuffered(state: SyncConsumerState, index: number): ByteBatch {
    const batch = this.#buffer.get(index);
    if (batch === undefined) throw new Error("share buffer cursor is out of range");
    const cursor = state.cursor;
    state.cursor++;
    if (
      cursor === this.#cachedMinCursor &&
      --this.#cachedMinCursorConsumers === 0
    ) this.#tryTrimBuffer();
    return batch;
  }

  #dropOldest(): void {
    while (
      this.#bufferedBytes >= this.#options.budget &&
      this.#buffer.length > 0
    ) {
      const removed = this.#buffer.shift();
      if (removed !== undefined) this.#bufferedBytes -= batchByteSize(removed);
      this.#bufferStart++;
    }
    for (const consumer of this.#consumers) {
      if (consumer.cursor < this.#bufferStart) consumer.cursor = this.#bufferStart;
    }
    this.#recomputeMinCursor();
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
  }

  #detachAfterTerminalState(state: SyncConsumerState): void {
    if (state.detached) return;
    state.detached = true;
    if (this.#deleteConsumer(state)) this.#tryTrimBuffer();
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

  #deleteConsumer(state: SyncConsumerState): boolean {
    if (!this.#consumers.delete(state)) return false;
    if (state.cursor !== this.#cachedMinCursor) return false;
    this.#cachedMinCursorConsumers--;
    return this.#cachedMinCursorConsumers === 0;
  }

  #backpressureError(suffix: string): ERR_OUT_OF_RANGE {
    return new ERR_OUT_OF_RANGE(
      "buffered bytes",
      `< ${this.#options.budget}${suffix}`,
      this.#bufferedBytes,
    );
  }
}

export function share(
  source: unknown,
  options: unknown = {},
): AsyncShareController {
  const normalized = from(source);
  const parsed = parseOptions(options, true);
  const controller = new AsyncShareController(normalized, parsed);
  if (parsed.signal !== undefined) {
    const signal = parsed.signal;
    const cancel = (): void => controller.cancel(signal.reason);
    if (signal.aborted) cancel();
    else signal.addEventListener("abort", cancel, { once: true });
  }
  return controller;
}

export function shareSync(
  source: unknown,
  options: unknown = {},
): SyncShareController {
  const normalized = fromSync(source);
  return new SyncShareController(normalized, parseOptions(options, false));
}

export interface ShareProtocolSource<Result extends object> {
  [shareProtocol](options?: unknown): Result;
}

export interface SyncShareProtocolSource<Result extends object> {
  [shareSyncProtocol](options?: unknown): Result;
}

function shareFrom<Result extends object>(
  input: ShareProtocolSource<Result>,
  options?: unknown,
): Result;
function shareFrom(
  input: AsyncByteStream | SyncByteStream,
  options?: unknown,
): AsyncShareController;
function shareFrom(
  input: unknown,
  options?: unknown,
): object | AsyncShareController {
  if (hasShareProtocol(input)) {
    const result = input[shareProtocol](options);
    if (result === null || typeof result !== "object") {
      throw new ERR_INVALID_RETURN_VALUE(
        "an object",
        "[Symbol.for('Stream.shareProtocol')]",
        result,
      );
    }
    return result;
  }
  if (isAsyncIterable(input) || isSyncIterable(input)) return share(input, options);
  throw new ERR_INVALID_ARG_TYPE(
    "input",
    ["Shareable", "AsyncIterable", "Iterable"],
    input,
  );
}

function shareFromSync<Result extends object>(
  input: SyncShareProtocolSource<Result>,
  options?: unknown,
): Result;
function shareFromSync(
  input: SyncByteStream,
  options?: unknown,
): SyncShareController;
function shareFromSync(
  input: unknown,
  options?: unknown,
): object | SyncShareController {
  if (hasShareSyncProtocol(input)) {
    const result = input[shareSyncProtocol](options);
    if (result === null || typeof result !== "object") {
      throw new ERR_INVALID_RETURN_VALUE(
        "an object",
        "[Symbol.for('Stream.shareSyncProtocol')]",
        result,
      );
    }
    return result;
  }
  if (isSyncIterable(input)) return shareSync(input, options);
  throw new ERR_INVALID_ARG_TYPE(
    "input",
    ["SyncShareable", "Iterable"],
    input,
  );
}

export const Share = {
  from: shareFrom,
};

export const SyncShare = {
  fromSync: shareFromSync,
};
