// Collection and observation utilities for Node v24.20.0 `node:stream/iter`.

import {
  ERR_INVALID_ARG_TYPE,
  ERR_INVALID_ARG_VALUE_RANGE,
  ERR_OUT_OF_RANGE,
} from "../../../internal/errors.ts";
import { validateInteger } from "../../../internal/validators.ts";
import type { StreamAbortSignal } from "./utils.ts";
import {
  concatBytes,
  isAsyncIterable,
  isSyncIterable,
  throwIfAborted,
  yieldAbortable,
} from "./utils.ts";
import { from, fromSync } from "./from.ts";
import { drainableProtocol } from "./types.ts";
import {
  hasToAsyncStreamable,
  hasToStreamable,
} from "./types.ts";
import { RingBuffer } from "./ring-buffer.ts";

interface DecodeOptions {
  stream?: boolean;
}

interface StreamTextDecoder {
  decode(
    input?: ArrayBuffer | ArrayBufferView<ArrayBufferLike>,
    options?: DecodeOptions,
  ): string;
}

interface StreamTextDecoderConstructor {
  new (label?: string, options?: { fatal?: boolean; ignoreBOM?: boolean }): StreamTextDecoder;
}

declare const TextDecoder: StreamTextDecoderConstructor;

export interface ConsumerOptions {
  encoding?: string;
  limit?: number;
  signal?: StreamAbortSignal;
}

const EMPTY_OPTIONS: ConsumerOptions = {};

function validateOptions(options: ConsumerOptions, allowSignal: boolean): void {
  if (options === null || typeof options !== "object" || Array.isArray(options)) {
    throw new ERR_INVALID_ARG_TYPE("options", "Object", options);
  }
  if (options.limit !== undefined) {
    validateInteger(options.limit, "options.limit", 0);
  }
  if (options.encoding !== undefined) {
    if (typeof options.encoding !== "string") {
      throw new ERR_INVALID_ARG_TYPE("options.encoding", "string", options.encoding);
    }
    try {
      new TextDecoder(options.encoding);
    } catch {
      throw new ERR_INVALID_ARG_VALUE_RANGE("options.encoding", options.encoding);
    }
  }
  if (allowSignal && options.signal !== undefined) {
    const signal = options.signal;
    if (signal === null || typeof signal !== "object" || !("aborted" in signal)) {
      throw new ERR_INVALID_ARG_TYPE("options.signal", "AbortSignal", signal);
    }
  }
}

function collectSync(source: unknown, limit?: number): Uint8Array[] {
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  for (const batch of fromSync(source)) {
    for (let i = 0; i < batch.length; i++) {
      const chunk = batch[i];
      if (chunk === undefined) continue;
      totalBytes += chunk.byteLength;
      if (limit !== undefined && totalBytes > limit) {
        throw new ERR_OUT_OF_RANGE("totalBytes", `<= ${limit}`, totalBytes);
      }
      chunks.push(chunk);
    }
  }
  return chunks;
}

async function collectAsync(
  source: unknown,
  signal?: StreamAbortSignal,
  limit?: number,
): Promise<Uint8Array[]> {
  if (signal !== undefined) throwIfAborted(signal);

  const initial = signal !== undefined && isAsyncIterable(source)
    ? yieldAbortable(source, signal)
    : source;
  const normalized = from(initial);
  const iterable = yieldAbortable(normalized, signal);
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  for await (const batch of iterable) {
    if (signal !== undefined) throwIfAborted(signal);
    for (let i = 0; i < batch.length; i++) {
      const chunk = batch[i];
      if (chunk === undefined) continue;
      totalBytes += chunk.byteLength;
      if (limit !== undefined && totalBytes > limit) {
        throw new ERR_OUT_OF_RANGE("totalBytes", `<= ${limit}`, totalBytes);
      }
      chunks.push(chunk);
    }
  }
  return chunks;
}

function toArrayBuffer(data: Uint8Array): ArrayBuffer {
  const buffer = data.buffer;
  if (buffer instanceof ArrayBuffer) {
    if (data.byteOffset === 0 && data.byteLength === buffer.byteLength) return buffer;
    return buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
  }
  const copy = new Uint8Array(data.byteLength);
  copy.set(data);
  return copy.buffer;
}

export function bytesSync(source: unknown, options: ConsumerOptions = EMPTY_OPTIONS): Uint8Array {
  validateOptions(options, false);
  return concatBytes(collectSync(source, options.limit));
}

export function textSync(source: unknown, options: ConsumerOptions = EMPTY_OPTIONS): string {
  validateOptions(options, false);
  const decoder = new TextDecoder(options.encoding ?? "utf-8", { fatal: true });
  return decoder.decode(concatBytes(collectSync(source, options.limit)));
}

export function arrayBufferSync(
  source: unknown,
  options: ConsumerOptions = EMPTY_OPTIONS,
): ArrayBuffer {
  validateOptions(options, false);
  return toArrayBuffer(concatBytes(collectSync(source, options.limit)));
}

export function arraySync(
  source: unknown,
  options: ConsumerOptions = EMPTY_OPTIONS,
): Uint8Array[] {
  validateOptions(options, false);
  return collectSync(source, options.limit);
}

export async function bytes(
  source: unknown,
  options: ConsumerOptions = EMPTY_OPTIONS,
): Promise<Uint8Array> {
  validateOptions(options, true);
  return concatBytes(await collectAsync(source, options.signal, options.limit));
}

export async function text(
  source: unknown,
  options: ConsumerOptions = EMPTY_OPTIONS,
): Promise<string> {
  validateOptions(options, true);
  const decoder = new TextDecoder(options.encoding ?? "utf-8", { fatal: true });
  return decoder.decode(concatBytes(await collectAsync(source, options.signal, options.limit)));
}

export async function arrayBuffer(
  source: unknown,
  options: ConsumerOptions = EMPTY_OPTIONS,
): Promise<ArrayBuffer> {
  validateOptions(options, true);
  return toArrayBuffer(concatBytes(await collectAsync(source, options.signal, options.limit)));
}

export async function array(
  source: unknown,
  options: ConsumerOptions = EMPTY_OPTIONS,
): Promise<Uint8Array[]> {
  validateOptions(options, true);
  return collectAsync(source, options.signal, options.limit);
}

export type TapCallback = (
  chunks: Uint8Array[] | null,
  options?: unknown,
) => void | PromiseLike<void>;

export function tap(callback: TapCallback): (
  chunks: Uint8Array[] | null,
  options?: unknown,
) => Promise<Uint8Array[] | null> {
  if (typeof callback !== "function") {
    throw new ERR_INVALID_ARG_TYPE("callback", "Function", callback);
  }
  return async (chunks, options): Promise<Uint8Array[] | null> => {
    await callback(chunks, options);
    return chunks;
  };
}

export function tapSync(
  callback: (chunks: Uint8Array[] | null) => void,
): (chunks: Uint8Array[] | null) => Uint8Array[] | null {
  if (typeof callback !== "function") {
    throw new ERR_INVALID_ARG_TYPE("callback", "Function", callback);
  }
  return (chunks): Uint8Array[] | null => {
    callback(chunks);
    return chunks;
  };
}

interface Drainable {
  [drainableProtocol](): Promise<boolean> | null;
}

function isDrainable(value: unknown): value is Drainable {
  return value !== null &&
    typeof value === "object" &&
    drainableProtocol in value &&
    typeof value[drainableProtocol] === "function";
}

/** Wait for a protocol-aware writer's byte budget to become writable. */
export function ondrain(value: unknown): Promise<boolean> | null {
  return isDrainable(value) ? value[drainableProtocol]() : null;
}

interface StreamSuppressedError extends Error {
  readonly error: unknown;
  readonly suppressed: unknown;
}

interface StreamSuppressedErrorConstructor {
  new (error: unknown, suppressed: unknown, message?: string): StreamSuppressedError;
}

declare const SuppressedError: StreamSuppressedErrorConstructor;

interface MergeOptions {
  signal?: StreamAbortSignal;
}

function isMergeOptions(value: unknown): value is MergeOptions {
  return value !== null &&
    typeof value === "object" &&
    !ArrayBuffer.isView(value) &&
    !(value instanceof ArrayBuffer) &&
    !(value instanceof SharedArrayBuffer) &&
    !hasToStreamable(value) &&
    !hasToAsyncStreamable(value) &&
    !isSyncIterable(value) &&
    !isAsyncIterable(value);
}

interface ReadyValue {
  readonly kind: "value";
  readonly iterator: AsyncIterator<Uint8Array[]>;
  readonly value: Uint8Array[];
}

interface ReadyError {
  readonly kind: "error";
  readonly error: unknown;
}

type ReadyItem = ReadyValue | ReadyError;

class MergedSource implements AsyncIterable<Uint8Array[]> {
  readonly #inputs: unknown[];
  readonly #sources: AsyncIterable<Uint8Array[]>[];
  readonly #signal?: StreamAbortSignal;

  constructor(
    inputs: unknown[],
    sources: AsyncIterable<Uint8Array[]>[],
    signal?: StreamAbortSignal,
  ) {
    this.#inputs = inputs;
    this.#sources = sources;
    this.#signal = signal;
  }

  async *[Symbol.asyncIterator](): AsyncGenerator<Uint8Array[]> {
    const signal = this.#signal;
    if (signal !== undefined) throwIfAborted(signal);
    if (this.#sources.length === 0) return;
    if (this.#sources.length === 1) {
      const normalized = this.#sources[0];
      const input = this.#inputs[0];
      if (normalized !== undefined) {
        const source = signal !== undefined && isAsyncIterable(input)
          ? from(yieldAbortable(input, signal))
          : yieldAbortable(normalized, signal);
        yield* source;
      }
      return;
    }

    const ready = new RingBuffer<ReadyItem>();
    const iterators = new Array<AsyncIterator<Uint8Array[]>>(this.#sources.length);
    let active = this.#sources.length;
    let wake: (() => void) | null = null;

    const notify = (): void => {
      const callback = wake;
      wake = null;
      callback?.();
    };
    const settled = (
      iterator: AsyncIterator<Uint8Array[]>,
      result: IteratorResult<Uint8Array[]>,
    ): void => {
      if (result.done) active--;
      else ready.push({ kind: "value", iterator, value: result.value });
      notify();
    };
    const failed = (error: unknown): void => {
      ready.push({ kind: "error", error });
      notify();
    };
    const read = (iterator: AsyncIterator<Uint8Array[]>): void => {
      void Promise.resolve(iterator.next()).then(
        (result): void => settled(iterator, result),
        failed,
      );
    };

    for (let i = 0; i < this.#sources.length; i++) {
      const source = this.#sources[i];
      if (source === undefined) continue;
      const iterator = source[Symbol.asyncIterator]();
      iterators[i] = iterator;
      read(iterator);
    }

    const onAbort = (): void => notify();
    if (signal !== undefined) signal.addEventListener("abort", onAbort, { once: true });

    let primaryError: unknown;
    let hasPrimaryError = false;
    try {
      while (active > 0 || ready.length > 0) {
        if (signal !== undefined) throwIfAborted(signal);
        while (ready.length > 0) {
          const item = ready.shift();
          if (item === undefined) continue;
          if (item.kind === "error") throw item.error;
          yield item.value;
          read(item.iterator);
        }
        if (active > 0) {
          await new Promise<void>((resolve) => {
            wake = resolve;
            if (signal?.aborted) notify();
          });
        }
      }
    } catch (error) {
      primaryError = error;
      hasPrimaryError = true;
    } finally {
      if (signal !== undefined) signal.removeEventListener("abort", onAbort);
      const cleanupError = await cleanupMergeIterators(
        iterators,
        signal?.aborted === true && hasPrimaryError && primaryError === signal.reason,
      );
      if (cleanupError !== undefined) {
        if (hasPrimaryError) throw new SuppressedError(primaryError, cleanupError);
        throw cleanupError;
      }
      if (hasPrimaryError) throw primaryError;
    }
  }
}

async function cleanupMergeIterators(
  iterators: readonly AsyncIterator<Uint8Array[]>[],
  skipAwait: boolean,
): Promise<unknown> {
  let firstError: unknown;
  let hasError = false;
  const cleanups: Promise<void>[] = [];

  for (let i = 0; i < iterators.length; i++) {
    const iterator = iterators[i];
    if (iterator?.return === undefined) continue;
    try {
      const returned = iterator.return();
      if (skipAwait) {
        void Promise.resolve(returned).catch((): void => {});
      } else {
        cleanups.push(Promise.resolve(returned).then(
          (): void => {},
          (error): void => {
            if (!hasError) {
              firstError = error;
              hasError = true;
            }
          },
        ));
      }
    } catch (error) {
      if (!hasError) {
        firstError = error;
        hasError = true;
      }
    }
  }
  await Promise.all(cleanups);
  return hasError ? firstError : undefined;
}

/** Yield batches from all sources in settlement order, one read per source. */
export function merge(...args: unknown[]): AsyncIterable<Uint8Array[]> {
  let end = args.length;
  let options: MergeOptions | undefined;
  const last = args[end - 1];
  if (isMergeOptions(last)) {
    options = last;
    end--;
  }
  if (options?.signal !== undefined) {
    const signal = options.signal;
    if (signal === null || typeof signal !== "object" || !("aborted" in signal)) {
      throw new ERR_INVALID_ARG_TYPE("options.signal", "AbortSignal", signal);
    }
  }

  const inputs = args.slice(0, end);
  const sources = new Array<AsyncIterable<Uint8Array[]>>(end);
  for (let i = 0; i < end; i++) sources[i] = from(inputs[i]);
  return new MergedSource(inputs, sources, options?.signal);
}
