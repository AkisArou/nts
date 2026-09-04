// Shared byte and cancellation operations for `node:stream/iter`, ported from
// Node v24.20.0 `lib/internal/streams/iter/utils.js`.

import {
  AbortError,
  ERR_INVALID_ARG_TYPE,
  ERR_INVALID_ARG_VALUE,
  ERR_OPERATION_FAILED,
} from "../../../internal/errors.ts";
import type { AbortSignalLike } from "../../../internal/abort.ts";

interface StreamTextEncoder {
  encode(input?: string): Uint8Array;
}

interface StreamTextEncoderConstructor {
  new (): StreamTextEncoder;
}

declare const TextEncoder: StreamTextEncoderConstructor;

export type ByteBatch = Uint8Array[];
export type SyncByteStream = Iterable<ByteBatch>;
export type AsyncByteStream = AsyncIterable<ByteBatch>;
export type ByteStream = SyncByteStream | AsyncByteStream;

export type BackpressurePolicy =
  | "strict"
  | "unbounded"
  | "drop-oldest"
  | "drop-newest";

export interface StreamAbortSignal extends AbortSignalLike {
  throwIfAborted?(): void;
}

/** Options accepted by every asynchronous Writer operation. */
export interface WriterOptions {
  signal?: StreamAbortSignal;
}

/** The byte sink consumed by `pipeTo` and adapted by `toWritable`. */
export interface AsyncWriter {
  readonly canWrite?: boolean | null;
  write(chunk: Uint8Array, options?: WriterOptions): unknown;
  writeSync?(chunk: Uint8Array): boolean;
  writev?(chunks: ByteBatch, options?: WriterOptions): unknown;
  writevSync?(chunks: ByteBatch): boolean;
  end?(options?: WriterOptions): unknown;
  endSync?(): number;
  fail?(error?: unknown): unknown;
}

/** The synchronous subset consumed by `pipeToSync`. */
export interface SyncWriter {
  writeSync(chunk: Uint8Array): boolean;
  writevSync?(chunks: ByteBatch): boolean;
  endSync?(): number;
  end?(): unknown;
  fail?(error?: unknown): unknown;
}

const encoder = new TextEncoder();

export function isAsyncWriter(value: unknown): value is AsyncWriter {
  return value !== null &&
    typeof value === "object" &&
    "write" in value &&
    typeof value.write === "function";
}

export function isSyncWriter(value: unknown): value is SyncWriter {
  return value !== null &&
    typeof value === "object" &&
    "writeSync" in value &&
    typeof value.writeSync === "function";
}

function validateWriterSignal(
  signal: unknown,
): asserts signal is StreamAbortSignal | undefined {
  if (
    signal !== undefined &&
    (signal === null || typeof signal !== "object" || !("aborted" in signal))
  ) {
    throw new ERR_INVALID_ARG_TYPE("options.signal", "AbortSignal", signal);
  }
}

/** Validate a Writer operation's options and return its cancellation signal. */
export function getWriterSignal(
  options?: WriterOptions,
): StreamAbortSignal | undefined {
  const signal = options?.signal;
  validateWriterSignal(signal);
  return signal;
}

export function validateBackpressure(
  value: unknown,
): asserts value is BackpressurePolicy {
  if (
    value !== "strict" &&
    value !== "unbounded" &&
    value !== "drop-oldest" &&
    value !== "drop-newest"
  ) {
    throw new ERR_INVALID_ARG_VALUE(
      "options.backpressure",
      value,
      "must be one of: 'strict', 'unbounded', 'drop-oldest', 'drop-newest'",
    );
  }
}

export function throwIfAborted(signal: StreamAbortSignal): void {
  if (signal.throwIfAborted !== undefined) {
    signal.throwIfAborted();
    return;
  }
  if (signal.aborted) {
    throw signal.reason ?? new AbortError();
  }
}

/** Convert one public byte chunk to the normalized representation. */
export function toUint8Array(chunk: string | Uint8Array): Uint8Array {
  if (typeof chunk === "string") return encoder.encode(chunk);
  if (!(chunk instanceof Uint8Array)) {
    throw new ERR_INVALID_ARG_TYPE("chunk", ["string", "Uint8Array"], chunk);
  }
  return chunk;
}

export function convertChunks(
  chunks: readonly (string | Uint8Array)[],
): ByteBatch {
  const converted = new Array<Uint8Array>(chunks.length);
  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    if (chunk !== undefined) converted[i] = toUint8Array(chunk);
  }
  return converted;
}

function copyBytes(chunk: Uint8Array): Uint8Array {
  const copy = new Uint8Array(chunk.byteLength);
  copy.set(chunk);
  return copy;
}

/** Concatenate batches without copying the sole full-buffer chunk. */
export function concatBytes(chunks: readonly Uint8Array[]): Uint8Array {
  if (chunks.length === 0) return new Uint8Array(0);

  const only = chunks.length === 1 ? chunks[0] : undefined;
  if (only !== undefined) {
    if (
      only.byteOffset === 0 &&
      only.buffer instanceof ArrayBuffer &&
      only.byteLength === only.buffer.byteLength
    ) {
      return only;
    }
    return copyBytes(only);
  }

  let totalByteLength = 0;
  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    if (chunk !== undefined) totalByteLength += chunk.byteLength;
  }

  const result = new Uint8Array(totalByteLength);
  let offset = 0;
  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    if (chunk === undefined) continue;
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

/** Read one async-iterator item, interrupting a pending read on abort. */
export async function abortableNext<T>(
  iterator: AsyncIterator<T>,
  signal?: StreamAbortSignal,
): Promise<IteratorResult<T>> {
  if (signal === undefined) return iterator.next();
  throwIfAborted(signal);

  let rejectAbort: (reason?: unknown) => void = (): void => {};
  const aborted = new Promise<never>((_resolve, reject) => {
    rejectAbort = reject;
  });
  const onAbort = (): void => rejectAbort(signal.reason ?? new AbortError());
  signal.addEventListener("abort", onAbort, { once: true });
  if (signal.aborted) onAbort();

  try {
    return await Promise.race([iterator.next(), aborted]);
  } finally {
    signal.removeEventListener("abort", onAbort);
  }
}

class AbortableAsyncSource<T> implements AsyncIterable<T> {
  readonly #source: AsyncIterable<T>;
  readonly #signal: StreamAbortSignal;

  constructor(source: AsyncIterable<T>, signal: StreamAbortSignal) {
    this.#source = source;
    this.#signal = signal;
  }

  async *[Symbol.asyncIterator](): AsyncGenerator<T> {
    const iterator = this.#source[Symbol.asyncIterator]();
    let completed = false;
    let aborted = false;

    try {
      while (true) {
        const result = await abortableNext(iterator, this.#signal);
        if (result.done) {
          completed = true;
          return;
        }
        throwIfAborted(this.#signal);
        yield result.value;
      }
    } catch (error) {
      aborted = this.#signal.aborted;
      throw error;
    } finally {
      if (!completed && iterator.return !== undefined) {
        const returned = iterator.return();
        if (aborted) {
          void Promise.resolve(returned).catch((): void => {});
        } else {
          await returned;
        }
      }
    }
  }
}

export function yieldAbortable<T>(
  source: AsyncIterable<T>,
  signal?: StreamAbortSignal,
): AsyncIterable<T> {
  return signal === undefined ? source : new AbortableAsyncSource(source, signal);
}

export function isSyncIterable(value: unknown): value is Iterable<unknown> {
  return typeof value !== "string" &&
    value !== null &&
    (typeof value === "object" || typeof value === "function") &&
    Symbol.iterator in value &&
    typeof value[Symbol.iterator] === "function";
}

export function isAsyncIterable(value: unknown): value is AsyncIterable<unknown> {
  return value !== null &&
    (typeof value === "object" || typeof value === "function") &&
    Symbol.asyncIterator in value &&
    typeof value[Symbol.asyncIterator] === "function";
}

export function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return value !== null &&
    (typeof value === "object" || typeof value === "function") &&
    "then" in value &&
    typeof value.then === "function";
}

export function wrapError(error: unknown): Error {
  return error instanceof Error ? error : new ERR_OPERATION_FAILED(String(error));
}
