// Byte-source normalization for Node v24.20.0's experimental
// `node:stream/iter` API. The 128-chunk bound is upstream's: transforms then
// have bounded peak memory even when a source is a very large flat array.

import { ERR_INVALID_ARG_TYPE } from "../../../internal/errors.ts";
import {
  hasToAsyncStreamable,
  hasToStreamable,
  isValidatedSource,
  toAsyncStreamable,
  toStreamable,
} from "./types.ts";
import {
  type AsyncByteStream,
  type ByteBatch,
  isAsyncIterable,
  isPromiseLike,
  isSyncIterable,
  type SyncByteStream,
} from "./utils.ts";

interface StreamTextEncoder {
  encode(input?: string): Uint8Array;
}

interface StreamTextEncoderConstructor {
  new (): StreamTextEncoder;
}

declare const TextEncoder: StreamTextEncoderConstructor;

const encoder = new TextEncoder();
const FROM_BATCH_SIZE = 128;

type PrimitiveChunk = string | ArrayBufferLike | ArrayBufferView<ArrayBufferLike>;

function isArrayBufferLike(value: unknown): value is ArrayBufferLike {
  return value instanceof ArrayBuffer || value instanceof SharedArrayBuffer;
}

export function isPrimitiveChunk(value: unknown): value is PrimitiveChunk {
  return typeof value === "string" || isArrayBufferLike(value) || ArrayBuffer.isView(value);
}

export function primitiveToUint8Array(chunk: PrimitiveChunk): Uint8Array {
  if (typeof chunk === "string") return encoder.encode(chunk);
  if (isArrayBufferLike(chunk)) return new Uint8Array(chunk);
  if (chunk instanceof Uint8Array) return chunk;
  return new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength);
}

export function arrayBufferViewToUint8Array(
  view: ArrayBufferView<ArrayBufferLike>,
): Uint8Array {
  return view instanceof Uint8Array
    ? view
    : new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
}

export function isUint8ArrayBatch(value: unknown): value is ByteBatch {
  if (!Array.isArray(value)) return false;
  for (let i = 0; i < value.length; i++) {
    if (!(value[i] instanceof Uint8Array)) return false;
  }
  return true;
}

function* normalizeSyncValue(value: unknown): Generator<Uint8Array> {
  if (isPrimitiveChunk(value)) {
    yield primitiveToUint8Array(value);
    return;
  }
  if (hasToStreamable(value)) {
    yield* normalizeSyncValue(value[toStreamable]());
    return;
  }
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      yield* normalizeSyncValue(value[i]);
    }
    return;
  }
  if (isSyncIterable(value)) {
    for (const item of value) yield* normalizeSyncValue(item);
    return;
  }
  throw new ERR_INVALID_ARG_TYPE(
    "value",
    ["string", "ArrayBuffer", "ArrayBufferView", "Iterable", "toStreamable"],
    value,
  );
}

function* yieldBoundedBatch(batch: ByteBatch): Generator<ByteBatch> {
  for (let offset = 0; offset < batch.length; offset += FROM_BATCH_SIZE) {
    yield batch.length <= FROM_BATCH_SIZE
      ? batch
      : batch.slice(offset, offset + FROM_BATCH_SIZE);
    if (batch.length <= FROM_BATCH_SIZE) return;
  }
}

export function* normalizeSyncSource(source: Iterable<unknown>): Generator<ByteBatch> {
  let batch: ByteBatch = [];
  for (const value of source) {
    if (isUint8ArrayBatch(value)) {
      if (batch.length > 0) {
        yield batch;
        batch = [];
      }
      yield* yieldBoundedBatch(value);
      continue;
    }
    if (value instanceof Uint8Array) {
      batch.push(value);
      if (batch.length === FROM_BATCH_SIZE) {
        yield batch;
        batch = [];
      }
      continue;
    }
    if (batch.length > 0) {
      yield batch;
      batch = [];
    }
    let normalized: ByteBatch = [];
    for (const chunk of normalizeSyncValue(value)) {
      normalized.push(chunk);
      if (normalized.length === FROM_BATCH_SIZE) {
        yield normalized;
        normalized = [];
      }
    }
    if (normalized.length > 0) yield normalized;
  }
  if (batch.length > 0) yield batch;
}

export async function* normalizeAsyncValue(
  value: unknown,
  allowNestedAsyncStreamables = true,
): AsyncGenerator<Uint8Array> {
  if (isPromiseLike(value)) {
    yield* normalizeAsyncValue(await value, allowNestedAsyncStreamables);
    return;
  }
  if (isPrimitiveChunk(value)) {
    yield primitiveToUint8Array(value);
    return;
  }
  if (
    !allowNestedAsyncStreamables &&
    (isAsyncIterable(value) || hasToAsyncStreamable(value))
  ) {
    throw new ERR_INVALID_ARG_TYPE(
      "value",
      ["string", "ArrayBuffer", "ArrayBufferView", "Iterable", "toStreamable"],
      value,
    );
  }
  if (hasToAsyncStreamable(value)) {
    yield* normalizeAsyncValue(await value[toAsyncStreamable](), allowNestedAsyncStreamables);
    return;
  }
  if (hasToStreamable(value)) {
    yield* normalizeAsyncValue(value[toStreamable](), allowNestedAsyncStreamables);
    return;
  }
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      yield* normalizeAsyncValue(value[i], allowNestedAsyncStreamables);
    }
    return;
  }
  if (isAsyncIterable(value)) {
    for await (const item of value) {
      yield* normalizeAsyncValue(item, allowNestedAsyncStreamables);
    }
    return;
  }
  if (isSyncIterable(value)) {
    for (const item of value) {
      yield* normalizeAsyncValue(item, allowNestedAsyncStreamables);
    }
    return;
  }
  throw new ERR_INVALID_ARG_TYPE(
    "value",
    [
      "string",
      "ArrayBuffer",
      "ArrayBufferView",
      "Iterable",
      "AsyncIterable",
      "toStreamable",
      "toAsyncStreamable",
    ],
    value,
  );
}

export async function* normalizeAsyncSource(source: unknown): AsyncGenerator<ByteBatch> {
  if (isAsyncIterable(source)) {
    for await (const value of source) {
      if (isUint8ArrayBatch(value)) {
        if (value.length > 0) yield value;
      } else if (value instanceof Uint8Array) {
        yield [value];
      } else {
        const batch: ByteBatch = [];
        for await (const chunk of normalizeAsyncValue(value)) batch.push(chunk);
        if (batch.length > 0) yield batch;
      }
    }
    return;
  }

  if (isSyncIterable(source)) {
    let batch: ByteBatch = [];
    for (const value of source) {
      if (isUint8ArrayBatch(value)) {
        if (batch.length > 0) {
          yield batch;
          batch = [];
        }
        yield* yieldBoundedBatch(value);
      } else if (value instanceof Uint8Array) {
        batch.push(value);
        if (batch.length === FROM_BATCH_SIZE) {
          yield batch;
          batch = [];
        }
      } else {
        if (batch.length > 0) {
          yield batch;
          batch = [];
        }
        let normalized: ByteBatch = [];
        for await (const chunk of normalizeAsyncValue(value, false)) {
          normalized.push(chunk);
          if (normalized.length === FROM_BATCH_SIZE) {
            yield normalized;
            normalized = [];
          }
        }
        if (normalized.length > 0) yield normalized;
      }
    }
    if (batch.length > 0) yield batch;
    return;
  }

  throw new ERR_INVALID_ARG_TYPE("source", ["Iterable", "AsyncIterable"], source);
}

class PrimitiveSyncSource implements SyncByteStream {
  readonly #chunk: Uint8Array;
  constructor(chunk: Uint8Array) {
    this.#chunk = chunk;
  }
  *[Symbol.iterator](): Generator<ByteBatch> {
    yield [this.#chunk];
  }
}

class BatchSyncSource implements SyncByteStream {
  readonly #batch: ByteBatch;
  constructor(batch: ByteBatch) {
    this.#batch = batch;
  }
  *[Symbol.iterator](): Generator<ByteBatch> {
    yield* yieldBoundedBatch(this.#batch);
  }
}

class NormalizedSyncSource implements SyncByteStream {
  readonly #source: Iterable<unknown>;
  constructor(source: Iterable<unknown>) {
    this.#source = source;
  }
  *[Symbol.iterator](): Generator<ByteBatch> {
    yield* normalizeSyncSource(this.#source);
  }
}

class PrimitiveAsyncSource implements AsyncByteStream {
  readonly #chunk: Uint8Array;
  constructor(chunk: Uint8Array) {
    this.#chunk = chunk;
  }
  async *[Symbol.asyncIterator](): AsyncGenerator<ByteBatch> {
    yield [this.#chunk];
  }
}

class BatchAsyncSource implements AsyncByteStream {
  readonly #batch: ByteBatch;
  constructor(batch: ByteBatch) {
    this.#batch = batch;
  }
  async *[Symbol.asyncIterator](): AsyncGenerator<ByteBatch> {
    yield* yieldBoundedBatch(this.#batch);
  }
}

class ProtocolAsyncSource implements AsyncByteStream {
  readonly #result: unknown;
  constructor(result: unknown) {
    this.#result = result;
  }
  async *[Symbol.asyncIterator](): AsyncGenerator<ByteBatch> {
    const resolved: unknown = await this.#result;
    if (isValidatedSource(resolved)) {
      yield* resolved;
    } else {
      yield* from(resolved);
    }
  }
}

export function fromSync(input: unknown): SyncByteStream {
  if (input === null || input === undefined) {
    throw new ERR_INVALID_ARG_TYPE("input", "a non-null value", input);
  }
  if (isPrimitiveChunk(input)) return new PrimitiveSyncSource(primitiveToUint8Array(input));
  if (isUint8ArrayBatch(input)) return new BatchSyncSource(input);
  if (hasToStreamable(input)) return fromSync(input[toStreamable]());

  if (!isSyncIterable(input)) {
    const expected = isAsyncIterable(input)
      ? "a synchronous input (not AsyncIterable)"
      : isPromiseLike(input)
        ? "a synchronous input (not Promise)"
        : ["string", "ArrayBuffer", "ArrayBufferView", "Iterable", "toStreamable"];
    throw new ERR_INVALID_ARG_TYPE("input", expected, input);
  }
  return new NormalizedSyncSource(input);
}

export function from(input: unknown): AsyncByteStream {
  if (input === null || input === undefined) {
    throw new ERR_INVALID_ARG_TYPE("input", "a non-null value", input);
  }
  if (isValidatedSource(input)) return input;
  if (isPrimitiveChunk(input)) return new PrimitiveAsyncSource(primitiveToUint8Array(input));
  if (isUint8ArrayBatch(input)) return new BatchAsyncSource(input);
  if (hasToAsyncStreamable(input)) {
    const result = input[toAsyncStreamable]();
    return isValidatedSource(result) ? result : new ProtocolAsyncSource(result);
  }
  if (hasToStreamable(input)) return from(input[toStreamable]());
  if (!isSyncIterable(input) && !isAsyncIterable(input)) {
    throw new ERR_INVALID_ARG_TYPE(
      "input",
      [
        "string",
        "ArrayBuffer",
        "ArrayBufferView",
        "Iterable",
        "AsyncIterable",
        "toStreamable",
        "toAsyncStreamable",
      ],
      input,
    );
  }
  return normalizeAsyncSource(input);
}
