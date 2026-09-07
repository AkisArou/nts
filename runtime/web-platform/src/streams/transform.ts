import { requireDictionary } from "../core/webidl.ts";
import {
  ReadableStream,
  readableStreamCanCloseOrEnqueue,
  readableStreamClose,
  readableStreamDesiredSize,
  readableStreamEnqueue,
  readableStreamError,
  readableStreamIsErrored,
  readableStreamStoredError,
  type UnderlyingSource,
} from "./readable.ts";
import {
  extractHighWaterMark,
  extractSizeAlgorithm,
  type QueuingStrategy,
} from "./queuing-strategy.ts";
import {
  WritableStream,
  writableStreamError,
  writableStreamIsFullyErrored,
  writableStreamIsErrored,
  writableStreamStoredError,
  type UnderlyingSink,
} from "./writable.ts";

export type TransformerStartCallback<I, O> = (
  this: Transformer<I, O>,
  controller: TransformStreamDefaultController<O>,
) => void | PromiseLike<void>;

export type TransformerTransformCallback<I, O> = (
  this: Transformer<I, O>,
  chunk: I | undefined,
  controller: TransformStreamDefaultController<O>,
) => void | PromiseLike<void>;

export type TransformerFlushCallback<I, O> = (
  this: Transformer<I, O>,
  controller: TransformStreamDefaultController<O>,
) => void | PromiseLike<void>;

export type TransformerCancelCallback<I, O> = (
  this: Transformer<I, O>,
  reason: unknown,
) => void | PromiseLike<void>;

export interface Transformer<I, O> {
  cancel?: TransformerCancelCallback<I, O>;
  flush?: TransformerFlushCallback<I, O>;
  readableType?: undefined;
  start?: TransformerStartCallback<I, O>;
  transform?: TransformerTransformCallback<I, O>;
  writableType?: undefined;
}

const transformStreamBrand: unique symbol = Symbol("TransformStream brand");
const transformControllerBrand: unique symbol = Symbol("TransformStreamDefaultController brand");
const transformControllerKey: unique symbol = Symbol("construct TransformStreamDefaultController");

const defaultTransformer = {
  cancel: undefined,
  flush: undefined,
  readableType: undefined,
  start: undefined,
  transform: undefined,
  writableType: undefined,
};
const defaultWritableStrategy = {
  highWaterMark: undefined,
  size: undefined,
};
const defaultReadableStrategy = {
  highWaterMark: undefined,
  size: undefined,
};

interface TransformReadableAlgorithms {
  pull(): Promise<void>;
  cancelReadable(reason: unknown): Promise<void>;
}

interface TransformWritableAlgorithms<I> {
  write(chunk: I | undefined): Promise<void>;
  closeWritable(): Promise<void>;
  abortWritable(reason: unknown): Promise<void>;
}

interface TransformControllerState<O> {
  readonly desiredSize: number | null;
  enqueue(chunk: O): void;
  error(reason: unknown): void;
  terminate(): void;
}

class TransformReadableSource<O> implements UnderlyingSource<O> {
  readonly start: () => Promise<void>;
  readonly pull: () => Promise<void>;
  readonly cancel: (reason: unknown) => Promise<void>;
  readonly type = undefined;

  constructor(owner: TransformReadableAlgorithms, startPromise: Promise<void>) {
    this.start = () => startPromise;
    this.pull = () => owner.pull();
    this.cancel = (reason) => owner.cancelReadable(reason);
  }
}

class TransformWritableSink<I> implements UnderlyingSink<I> {
  readonly start: () => Promise<void>;
  readonly write: (chunk: I | undefined) => Promise<void>;
  readonly close: () => Promise<void>;
  readonly abort: (reason: unknown) => Promise<void>;
  readonly type = undefined;

  constructor(owner: TransformWritableAlgorithms<I>, startPromise: Promise<void>) {
    this.start = () => startPromise;
    this.write = (chunk) => owner.write(chunk);
    this.close = () => owner.closeWritable();
    this.abort = (reason) => owner.abortWritable(reason);
  }
}

class TransformStreamState<I, O> {
  readonly readable: ReadableStream<O>;
  readonly writable: WritableStream<I>;
  readonly controller: TransformStreamDefaultController<O>;
  #transformer: Transformer<I, O> | null;
  #transformAlgorithm: TransformerTransformCallback<I, O> | undefined;
  #flushAlgorithm: TransformerFlushCallback<I, O> | undefined;
  #cancelAlgorithm: TransformerCancelCallback<I, O> | undefined;
  #backpressure = true;
  #backpressureChange: PromiseWithResolvers<void> | null = null;
  #finish: PromiseWithResolvers<void> | null = null;

  constructor(
    transformer: Transformer<I, O>,
    writableHighWaterMark: number,
    writableSizeAlgorithm: (chunk: I | undefined) => number,
    readableHighWaterMark: number,
    readableSizeAlgorithm: (chunk: O) => number,
    startCapability: PromiseWithResolvers<void>,
  ) {
    this.#transformer = transformer;
    this.#transformAlgorithm = transformer.transform;
    this.#flushAlgorithm = transformer.flush;
    this.#cancelAlgorithm = transformer.cancel;
    this.controller = new TransformStreamDefaultController(transformControllerKey, this);

    this.writable = new WritableStream<I>(
      new TransformWritableSink<I>(this, startCapability.promise),
      { highWaterMark: writableHighWaterMark, size: writableSizeAlgorithm },
    );
    this.readable = new ReadableStream<O>(
      new TransformReadableSource<O>(this, startCapability.promise),
      { highWaterMark: readableHighWaterMark, size: readableSizeAlgorithm },
    );
  }

  get desiredSize(): number | null {
    return readableStreamDesiredSize(this.readable);
  }

  enqueue(chunk: O): void {
    if (!readableStreamCanCloseOrEnqueue(this.readable)) {
      throw new TypeError("TransformStream readable side cannot accept a chunk");
    }
    try {
      readableStreamEnqueue(this.readable, chunk);
    } catch (error) {
      this.#errorWritableAndUnblock(error);
      throw readableStreamStoredError(this.readable);
    }
    const backpressure = (readableStreamDesiredSize(this.readable) ?? 0) <= 0;
    if (backpressure !== this.#backpressure) {
      this.#setBackpressure(backpressure);
    }
  }

  error(reason: unknown): void {
    readableStreamError(this.readable, reason);
    this.#errorWritableAndUnblock(reason);
  }

  terminate(): void {
    if (readableStreamCanCloseOrEnqueue(this.readable)) {
      readableStreamClose(this.readable);
    }
    this.#errorWritableAndUnblock(new TypeError("TransformStream has been terminated"));
  }

  async write(chunk: I | undefined): Promise<void> {
    if (this.#backpressure) {
      await this.#backpressureChangePromise();
      if (writableStreamIsErrored(this.writable)) {
        throw writableStreamStoredError(this.writable);
      }
    }

    const transformer = this.#transformer;
    const transform = this.#transformAlgorithm;
    if (transformer === null) {
      return;
    }
    try {
      if (transform === undefined) {
        this.enqueue(chunk as O);
      } else {
        await transform.call(transformer, chunk, this.controller);
      }
    } catch (error) {
      this.error(error);
      throw error;
    }
  }

  pull(): Promise<void> {
    if (this.#backpressure) {
      this.#setBackpressure(false);
    }
    return this.#backpressureChangePromise();
  }

  async closeWritable(): Promise<void> {
    const existing = this.#finish;
    if (existing !== null) {
      return existing.promise;
    }
    const finish = Promise.withResolvers<void>();
    this.#finish = finish;
    this.#finishWritableClose(finish);
    return finish.promise;
  }

  async abortWritable(reason: unknown): Promise<void> {
    const existing = this.#finish;
    if (existing !== null) {
      return existing.promise;
    }
    const finish = Promise.withResolvers<void>();
    this.#finish = finish;
    this.#finishWritableAbort(reason, finish);
    return finish.promise;
  }

  async cancelReadable(reason: unknown): Promise<void> {
    const existing = this.#finish;
    if (existing !== null) {
      return existing.promise;
    }
    const finish = Promise.withResolvers<void>();
    this.#finish = finish;
    this.#finishReadableCancel(reason, finish);
    return finish.promise;
  }

  #backpressureChangePromise(): Promise<void> {
    if (this.#backpressureChange === null) {
      this.#backpressureChange = Promise.withResolvers<void>();
    }
    return this.#backpressureChange.promise;
  }

  #setBackpressure(backpressure: boolean): void {
    if (backpressure === this.#backpressure) {
      return;
    }
    const change = this.#backpressureChange;
    this.#backpressureChange = null;
    this.#backpressure = backpressure;
    change?.resolve();
  }

  #clearAlgorithms(): void {
    this.#transformer = null;
    this.#transformAlgorithm = undefined;
    this.#flushAlgorithm = undefined;
    this.#cancelAlgorithm = undefined;
  }

  #errorWritableAndUnblock(reason: unknown): void {
    this.#clearAlgorithms();
    writableStreamError(this.writable, reason);
    if (this.#backpressure) {
      this.#setBackpressure(false);
    }
  }

  async #finishWritableClose(finish: PromiseWithResolvers<void>): Promise<void> {
    const transformer = this.#transformer;
    const flush = this.#flushAlgorithm;
    try {
      let flushResult: void | PromiseLike<void> = undefined;
      if (transformer !== null && flush !== undefined) {
        flushResult = flush.call(transformer, this.controller);
      }
      await flushResult;
      this.#clearAlgorithms();
      if (readableStreamIsErrored(this.readable)) {
        throw readableStreamStoredError(this.readable);
      }
      if (readableStreamCanCloseOrEnqueue(this.readable)) {
        readableStreamClose(this.readable);
      }
      finish.resolve();
    } catch (error) {
      this.#clearAlgorithms();
      readableStreamError(this.readable, error);
      finish.reject(error);
    }
  }

  async #finishWritableAbort(reason: unknown, finish: PromiseWithResolvers<void>): Promise<void> {
    const transformer = this.#transformer;
    const cancel = this.#cancelAlgorithm;
    try {
      let cancelResult: void | PromiseLike<void> = undefined;
      if (transformer !== null && cancel !== undefined) {
        cancelResult = cancel.call(transformer, reason);
      }
      await cancelResult;
      this.#clearAlgorithms();
      if (readableStreamIsErrored(this.readable)) {
        throw readableStreamStoredError(this.readable);
      }
      readableStreamError(this.readable, reason);
      finish.resolve();
    } catch (error) {
      this.#clearAlgorithms();
      readableStreamError(this.readable, error);
      finish.reject(error);
    }
  }

  async #finishReadableCancel(reason: unknown, finish: PromiseWithResolvers<void>): Promise<void> {
    const transformer = this.#transformer;
    const cancel = this.#cancelAlgorithm;
    const hadCancelAlgorithm = transformer !== null && cancel !== undefined;
    const startedErrored = writableStreamIsFullyErrored(this.writable);
    try {
      let cancelResult: void | PromiseLike<void> = undefined;
      if (hadCancelAlgorithm) {
        cancelResult = cancel.call(transformer, reason);
      }
      await cancelResult;
      this.#clearAlgorithms();
      if (writableStreamIsFullyErrored(this.writable) && (hadCancelAlgorithm || startedErrored)) {
        throw writableStreamStoredError(this.writable);
      }
      writableStreamError(this.writable, reason);
      if (this.#backpressure) {
        this.#setBackpressure(false);
      }
      finish.resolve();
    } catch (error) {
      this.#clearAlgorithms();
      writableStreamError(this.writable, error);
      if (this.#backpressure) {
        this.#setBackpressure(false);
      }
      finish.reject(error);
    }
  }
}

export class TransformStream<I = unknown, O = unknown> {
  readonly [transformStreamBrand] = true;
  readonly #state: TransformStreamState<I, O>;

  constructor(
    transformer: Transformer<I, O> | null = defaultTransformer,
    writableStrategy: QueuingStrategy<I | undefined> | null = defaultWritableStrategy,
    readableStrategy: QueuingStrategy<O> | null = defaultReadableStrategy,
  ) {
    requireDictionary(transformer, "Transformer");
    if (transformer === null) {
      throw new TypeError("Transformer must be an object");
    }

    const readableType = transformer.readableType;
    const writableType = transformer.writableType;
    const start = transformer.start;
    if (readableType !== undefined) {
      throw new RangeError("Transformer readableType is not supported");
    }
    if (writableType !== undefined) {
      throw new RangeError("Transformer writableType is not supported");
    }
    if (start !== undefined && typeof start !== "function") {
      throw new TypeError("Transformer start must be callable");
    }
    if (transformer.transform !== undefined && typeof transformer.transform !== "function") {
      throw new TypeError("Transformer transform must be callable");
    }
    if (transformer.flush !== undefined && typeof transformer.flush !== "function") {
      throw new TypeError("Transformer flush must be callable");
    }
    if (transformer.cancel !== undefined && typeof transformer.cancel !== "function") {
      throw new TypeError("Transformer cancel must be callable");
    }

    const readableSize = extractSizeAlgorithm(readableStrategy);
    const readableHighWaterMark = extractHighWaterMark(readableStrategy, 0);
    const writableSize = extractSizeAlgorithm(writableStrategy);
    const writableHighWaterMark = extractHighWaterMark(writableStrategy, 1);
    const startCapability = Promise.withResolvers<void>();
    this.#state = new TransformStreamState(
      transformer,
      writableHighWaterMark,
      writableSize,
      readableHighWaterMark,
      readableSize,
      startCapability,
    );

    try {
      startCapability.resolve(start?.call(transformer, this.#state.controller));
    } catch (error) {
      startCapability.reject(error);
      throw error;
    }
  }

  get readable(): ReadableStream<O> {
    if (!(transformStreamBrand in this) || this[transformStreamBrand] !== true) {
      throw new TypeError("TransformStream method called on an incompatible receiver");
    }
    return this.#state.readable;
  }

  get writable(): WritableStream<I> {
    if (!(transformStreamBrand in this) || this[transformStreamBrand] !== true) {
      throw new TypeError("TransformStream method called on an incompatible receiver");
    }
    return this.#state.writable;
  }


  // Web IDL surface shape; see core/interface-tag.ts for the rule and why it is
  // written inline rather than through a helper.
  static {
    Object.defineProperty(this.prototype, Symbol.toStringTag, {
      value: "TransformStream",
      writable: false,
      enumerable: false,
      configurable: true,
    });
  }
}

export class TransformStreamDefaultController<O = unknown> {
  readonly [transformControllerBrand] = true;
  readonly #state: TransformControllerState<O>;

  constructor(...args: [typeof transformControllerKey, TransformControllerState<O>]) {
    const key = args[0];
    const state = args[1];
    if (key !== transformControllerKey || state === undefined) {
      throw new TypeError("Illegal constructor");
    }
    this.#state = state;
  }

  get desiredSize(): number | null {
    return this.#state.desiredSize;
  }

  enqueue(chunk: O): void {
    this.#state.enqueue(chunk);
  }

  error(reason: unknown = undefined): void {
    this.#state.error(reason);
  }

  terminate(): void {
    this.#state.terminate();
  }


  // Web IDL surface shape; see core/interface-tag.ts for the rule and why it is
  // written inline rather than through a helper.
  static {
    Object.defineProperty(this.prototype, Symbol.toStringTag, {
      value: "TransformStreamDefaultController",
      writable: false,
      enumerable: false,
      configurable: true,
    });
  }
}
