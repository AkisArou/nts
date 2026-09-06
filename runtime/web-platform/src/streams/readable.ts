import { Deferred, ignoreRejection } from "../core/deferred.ts";
import { LimitError } from "../core/errors.ts";

export type ReadResult<T> = { done: false; value: T } | { done: true; value: undefined };

export interface UnderlyingSource<T> {
  start?(controller: ReadableStreamDefaultController<T>): void | Promise<void>;
  pull?(controller: ReadableStreamDefaultController<T>): void | Promise<void>;
  cancel?(reason: unknown): void | Promise<void>;
}

export interface QueuingStrategy<T> {
  highWaterMark?: number;
  size?(chunk: T): number;
}

interface QueueEntry<T> {
  value: T;
  size: number;
}
/**
 * Default-reader Streams subset, not BYOB or a Web-IDL implementation. Reads are
 * pull-driven, with a single in-flight underlying pull and explicit ownership.
 */
export class ReadableStream<T> {
  private readonly source: UnderlyingSource<T>;
  private readonly controller: ReadableStreamDefaultController<T>;
  private readonly highWaterMark: number;
  private readonly sizeOf: (value: T) => number;
  private queue: QueueEntry<T>[] = [];
  private queueHead = 0;
  private totalSize = 0;
  private pending: Deferred<ReadResult<T>>[] = [];
  private currentReader: ReadableStreamDefaultReader<T> | null = null;
  private state: "readable" | "closed" | "errored" = "readable";
  private storedError: unknown;
  private closeRequested = false;
  private started = false;
  private pulling = false;
  private pullAgain = false;
  private isDisturbed = false;

  constructor(source: UnderlyingSource<T> = {}, strategy: QueuingStrategy<T> = {}) {
    this.source = source;
    this.highWaterMark = strategy.highWaterMark ?? 1;
    if (Number.isNaN(this.highWaterMark) || this.highWaterMark < 0)
      throw new RangeError("Invalid highWaterMark");
    this.sizeOf = strategy.size ?? (() => 1);
    this.controller = new ReadableStreamDefaultController(this);
    try {
      Promise.resolve(source.start?.(this.controller)).then(
        () => {
          this.started = true;
          this.maybePull();
        },
        (error) => this.fail(error),
      );
    } catch (error) {
      this.fail(error);
    }
  }

  get locked(): boolean {
    return this.currentReader !== null;
  }
  /** @internal */ get disturbed(): boolean {
    return this.isDisturbed;
  }
  /** @internal */ get queuedSize(): number {
    return this.totalSize;
  }
  /** @internal */ markDisturbed(): void {
    this.isDisturbed = true;
  }

  getReader(): ReadableStreamDefaultReader<T> {
    if (this.locked) throw new TypeError("Stream is locked");
    return new ReadableStreamDefaultReader(this);
  }
  /** @internal */ attach(reader: ReadableStreamDefaultReader<T>): void {
    if (this.locked) throw new TypeError("Stream is locked");
    this.currentReader = reader;
    if (this.state === "closed") reader.finish();
    if (this.state === "errored") reader.fail(this.storedError);
  }

  cancel(reason?: unknown): Promise<void> {
    if (this.locked) return Promise.reject(new TypeError("Stream is locked"));
    return this.cancelInternal(reason);
  }
  /** @internal */ async cancelInternal(reason: unknown): Promise<void> {
    this.isDisturbed = true;
    if (this.state === "closed") return;
    if (this.state === "errored") throw this.storedError;
    this.queue = [];
    this.queueHead = 0;
    this.totalSize = 0;
    this.finish();
    await this.source.cancel?.(reason);
  }
  /** @internal */ read(reader: ReadableStreamDefaultReader<T>): Promise<ReadResult<T>> {
    if (reader !== this.currentReader)
      return Promise.reject(new TypeError("Reader has been released"));
    this.isDisturbed = true;
    if (this.state === "closed") return Promise.resolve({ done: true, value: undefined });
    if (this.state === "errored") return Promise.reject(this.storedError);
    const entry = this.queue[this.queueHead];
    if (entry !== undefined) {
      this.queueHead++;
      this.totalSize -= entry.size;
      if (this.queueHead === this.queue.length) {
        this.queue = [];
        this.queueHead = 0;
      } else if (this.queueHead > 1024 && this.queueHead * 2 > this.queue.length) {
        this.queue = this.queue.slice(this.queueHead);
        this.queueHead = 0;
      }
      if (this.closeRequested && this.queueHead === this.queue.length) this.finish();
      else this.maybePull();
      return Promise.resolve({ done: false, value: entry.value });
    }
    const result = new Deferred<ReadResult<T>>();
    this.pending.push(result);
    this.maybePull();
    return result.promise;
  }
  /** @internal */ release(reader: ReadableStreamDefaultReader<T>): void {
    if (reader !== this.currentReader) return;
    this.currentReader = null;
    const error = new TypeError("Reader has been released");
    for (const read of this.pending.splice(0)) read.reject(error);
    reader.released(error);
  }
  /** @internal */ enqueue(value: T): void {
    if (this.state !== "readable" || this.closeRequested)
      throw new TypeError("Stream is not writable");
    const read = this.pending.shift();
    if (read !== undefined) read.resolve({ done: false, value });
    else {
      let size: number;
      try {
        size = this.sizeOf(value);
        if (!Number.isFinite(size) || size < 0) throw new RangeError("Invalid chunk size");
      } catch (error) {
        this.fail(error);
        throw error;
      }
      this.queue.push({ value, size });
      this.totalSize += size;
    }
    this.maybePull();
  }
  /** @internal */ requestClose(): void {
    if (this.state !== "readable" || this.closeRequested)
      throw new TypeError("Stream cannot be closed twice");
    this.closeRequested = true;
    if (this.queueHead === this.queue.length) this.finish();
  }
  private finish(): void {
    this.state = "closed";
    for (const read of this.pending.splice(0)) read.resolve({ done: true, value: undefined });
    this.currentReader?.finish();
  }
  /** @internal */ fail(error: unknown): void {
    if (this.state !== "readable") return;
    this.state = "errored";
    this.storedError = error;
    this.queue = [];
    this.queueHead = 0;
    this.totalSize = 0;
    for (const read of this.pending.splice(0)) read.reject(error);
    this.currentReader?.fail(error);
  }
  /** @internal */ get desiredSize(): number | null {
    if (this.state === "errored") return null;
    if (this.state === "closed") return 0;
    return this.highWaterMark - this.totalSize;
  }
  private maybePull(): void {
    if (!this.started || this.state !== "readable" || this.closeRequested) return;
    if (this.pending.length === 0 && this.highWaterMark <= this.totalSize) return;
    if (this.pulling) {
      this.pullAgain = true;
      return;
    }
    this.pulling = true;
    Promise.resolve()
      .then(() => this.source.pull?.(this.controller))
      .then(
        () => {
          this.pulling = false;
          if (this.pullAgain) {
            this.pullAgain = false;
            this.maybePull();
          }
        },
        (error) => {
          this.pulling = false;
          this.fail(error);
        },
      );
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
        if (!ended && !options.preventCancel) await reader.cancel();
      } finally {
        reader.releaseLock();
      }
    }
  }

  [Symbol.asyncIterator](): AsyncGenerator<T, void, unknown> {
    return this.values();
  }
}

export class ReadableStreamDefaultController<T> {
  private readonly stream: ReadableStream<T>;

  constructor(stream: ReadableStream<T>) {
    this.stream = stream;
  }

  get desiredSize(): number | null {
    return this.stream.desiredSize;
  }

  enqueue(chunk: T): void {
    this.stream.enqueue(chunk);
  }

  close(): void {
    this.stream.requestClose();
  }

  error(reason?: unknown): void {
    this.stream.fail(reason);
  }
}

export class ReadableStreamDefaultReader<T> {
  private stream: ReadableStream<T> | null;
  private closedCapability = new Deferred<void>();

  get closed(): Promise<void> {
    return this.closedCapability.promise;
  }

  constructor(stream: ReadableStream<T>) {
    this.stream = stream;
    ignoreRejection(this.closed);
    stream.attach(this);
  }
  /** @internal */ released(error: unknown): void {
    if (this.closedCapability.settled) {
      this.closedCapability = new Deferred<void>();
      ignoreRejection(this.closed);
    }
    this.closedCapability.reject(error);
  }

  read(): Promise<ReadResult<T>> {
    return this.stream === null
      ? Promise.reject(new TypeError("Reader has been released"))
      : this.stream.read(this);
  }

  cancel(reason?: unknown): Promise<void> {
    return this.stream === null
      ? Promise.reject(new TypeError("Reader has been released"))
      : this.stream.cancelInternal(reason);
  }

  releaseLock(): void {
    this.stream?.release(this);
    this.stream = null;
  }
  /** @internal */ finish(): void {
    this.closedCapability.resolve();
  }
  /** @internal */ fail(error: unknown): void {
    this.closedCapability.reject(error);
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
      { highWaterMark: 0, size },
    );
  }
}

class TeeState<T> {
  readonly branches: [TeeBranch<T>, TeeBranch<T>];
  private readonly reader: ReadableStreamDefaultReader<T>;
  private readonly clone: (chunk: T) => T;
  private readonly size: (chunk: T) => number;
  private readonly limit: number;
  private readonly canceled = new Deferred<void>();
  private reading: Promise<void> | null = null;
  private done = false;

  constructor(stream: ReadableStream<T>, options: TeeOptions<T>) {
    this.reader = stream.getReader();
    this.clone = options.clone ?? ((value) => value);
    this.size = options.size ?? (() => 1);
    this.limit = options.maxBufferedSize ?? Infinity;
    this.branches = [new TeeBranch(this, 0, this.size), new TeeBranch(this, 1, this.size)];
    ignoreRejection(this.canceled.promise);
  }

  pull(): Promise<void> {
    if (this.done) return Promise.resolve();
    if (this.reading !== null) return this.reading;
    this.reading = this.readOne().finally(() => {
      this.reading = null;
    });
    return this.reading;
  }
  private async readOne(): Promise<void> {
    try {
      const result = await this.reader.read();
      if (this.done) return;
      if (result.done) {
        this.done = true;
        for (const branch of this.branches) if (!branch.canceled) branch.controller?.close();
        this.reader.releaseLock();
        this.canceled.resolve();
        return;
      }
      const size = this.size(result.value);
      for (const branch of this.branches) {
        if (!branch.canceled && branch.stream.queuedSize + size > this.limit) {
          throw new LimitError("Clone backlog exceeded configured limit");
        }
      }
      const first = this.branches[0];
      const second = this.branches[1];
      // Clone before handing either branch a mutable chunk.
      const secondValue = second.canceled ? result.value : this.clone(result.value);
      if (!first.canceled) first.controller?.enqueue(result.value);
      if (!second.canceled) second.controller?.enqueue(secondValue);
    } catch (error) {
      this.done = true;
      for (const branch of this.branches) if (!branch.canceled) branch.controller?.error(error);
      ignoreRejection(this.reader.cancel(error));
      this.reader.releaseLock();
      this.canceled.reject(error);
    }
  }

  cancel(index: number, reason: unknown): Promise<void> {
    const branch = this.branches[index];
    if (branch !== undefined) {
      branch.canceled = true;
      branch.reason = reason;
    }
    if (this.branches[0].canceled && this.branches[1].canceled && !this.done) {
      this.done = true;
      this.reader.cancel([this.branches[0].reason, this.branches[1].reason]).then(
        () => {
          this.reader.releaseLock();
          this.canceled.resolve();
        },
        (error) => {
          this.reader.releaseLock();
          this.canceled.reject(error);
        },
      );
    }
    return this.canceled.promise;
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
  if (!Number.isSafeInteger(chunkSize) || chunkSize < 1)
    throw new RangeError("Invalid byte chunk size");
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
/** The source becomes disturbed immediately, matching Request body transfer. */
export function transfer<T>(stream: ReadableStream<T>): ReadableStream<T> {
  const reader = stream.getReader();

  stream.markDisturbed();
  return new ReadableStream<T>(
    {
      async pull(controller) {
        const result = await reader.read();
        if (result.done) {
          controller.close();
          reader.releaseLock();
        } else controller.enqueue(result.value);
      },
      async cancel(reason) {
        try {
          await reader.cancel(reason);
        } finally {
          reader.releaseLock();
        }
      },
    },
    { highWaterMark: 0 },
  );
}
