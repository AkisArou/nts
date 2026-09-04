// Classic Readable -> stream/iter source interop from Node v24.20.0
// `lib/internal/streams/iter/classic.js`.

import {
  aggregateTwoErrors,
  ERR_INVALID_ARG_TYPE,
} from "../../../internal/errors.ts";
import { destroyer } from "../destroy.ts";
import { eos } from "../end-of-stream.ts";
import { normalizeAsyncValue } from "./from.ts";
import { kValidatedSource } from "./types.ts";
import type {
  AsyncByteStream,
  ByteBatch,
} from "./utils.ts";

const MAX_DRAIN_BATCH = 128;

interface ClassicReadableState {
  readonly autoDestroy?: boolean;
  readonly encoding?: string | null;
  readonly objectMode?: boolean;
  readonly length?: number;
}

/** The fixed portion of a classic Readable used by the adapter. */
export interface ClassicReadableLike {
  readonly destroyed?: boolean;
  readonly _readableState?: ClassicReadableState;
  read(): unknown;
  on<Args extends unknown[]>(
    event: string,
    listener: (...args: Args) => unknown,
  ): unknown;
  off?<Args extends unknown[]>(
    event: string,
    listener: (...args: Args) => unknown,
  ): unknown;
  removeListener?<Args extends unknown[]>(
    event: string,
    listener: (...args: Args) => unknown,
  ): unknown;
  destroy?(error?: unknown): unknown;
}

export function isClassicReadable(value: unknown): value is ClassicReadableLike {
  return value !== null &&
    (typeof value === "object" || typeof value === "function") &&
    "read" in value &&
    typeof value.read === "function" &&
    "on" in value &&
    typeof value.on === "function";
}

/** Normalize one object-mode/encoded drain without splitting its batch. */
async function normalizeBatch(raw: readonly unknown[]): Promise<ByteBatch | null> {
  const batch: ByteBatch = [];
  for (let i = 0; i < raw.length; i++) {
    const value = raw[i];
    if (value instanceof Uint8Array) {
      batch.push(value);
    } else {
      for await (const normalized of normalizeAsyncValue(value)) {
        batch.push(normalized);
      }
    }
  }
  return batch.length === 0 ? null : batch;
}

function byteBatch(raw: readonly unknown[]): ByteBatch {
  const batch = new Array<Uint8Array>(raw.length);
  for (let i = 0; i < raw.length; i++) {
    const chunk = raw[i];
    if (!(chunk instanceof Uint8Array)) {
      throw new ERR_INVALID_ARG_TYPE("chunk", "Uint8Array", chunk);
    }
    batch[i] = chunk;
  }
  return batch;
}

function removeReadableListener(
  stream: ClassicReadableLike,
  listener: () => void,
): void {
  if (stream.off !== undefined) stream.off("readable", listener);
  else stream.removeListener?.("readable", listener);
}

/**
 * Drain every currently buffered chunk per iteration, capped at 128 chunks.
 * One promise therefore represents a useful batch instead of one tiny chunk.
 */
async function* createBatchedAsyncIterator(
  stream: ClassicReadableLike,
  normalize: boolean,
): AsyncGenerator<ByteBatch, void, void> {
  let wake: (() => void) | null = null;

  const onReadable = (): void => {
    if (wake === null) return;
    const resolve = wake;
    wake = null;
    resolve();
  };
  stream.on("readable", onReadable);

  let error: unknown;
  const cleanup = eos(stream, { writable: false }, (finishedError) => {
    error = finishedError ? aggregateTwoErrors(error, finishedError) : null;
    onReadable();
  });

  try {
    for (;;) {
      const chunk = stream.destroyed ? null : stream.read();
      if (chunk !== null) {
        const raw: unknown[] = [chunk];
        while (
          raw.length < MAX_DRAIN_BATCH &&
          (stream._readableState?.length ?? 0) > 0
        ) {
          const buffered = stream.read();
          if (buffered === null) break;
          raw.push(buffered);
        }

        if (normalize) {
          const normalized = await normalizeBatch(raw);
          if (normalized !== null) yield normalized;
        } else {
          yield byteBatch(raw);
        }
      } else if (error) {
        throw error;
      } else if (error === null) {
        return;
      } else {
        await new Promise<void>((resolve) => {
          wake = resolve;
        });
      }
    }
  } catch (caught) {
    error = aggregateTwoErrors(error, caught);
    throw error;
  } finally {
    if (error === undefined || stream._readableState?.autoDestroy) {
      destroyer(stream, null);
    } else {
      removeReadableListener(stream, onReadable);
      cleanup();
    }
  }
}

/** A one-shot, validated source retaining the classic stream it drains. */
export class ClassicReadableSource implements AsyncByteStream {
  readonly [kValidatedSource] = true;
  readonly stream: ClassicReadableLike;
  readonly #iterator: AsyncGenerator<ByteBatch, void, void>;

  constructor(stream: ClassicReadableLike) {
    this.stream = stream;
    const state = stream._readableState;
    const normalize = Boolean(state?.objectMode || state?.encoding);
    this.#iterator = createBatchedAsyncIterator(stream, normalize);
  }

  [Symbol.asyncIterator](): AsyncIterator<ByteBatch> {
    return this.#iterator;
  }
}

export function classicReadableSource(
  stream: ClassicReadableLike,
): ClassicReadableSource {
  return new ClassicReadableSource(stream);
}
