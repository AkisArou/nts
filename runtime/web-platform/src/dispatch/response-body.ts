import type { AbortSignal } from "../core/abort.ts";
import { concatBytes } from "../core/encoding.ts";
import { ignoreRejection } from "../core/promise.ts";
import { Headers } from "../fetch/headers.ts";
import type { HeaderEntry } from "../fetch/headers.ts";
import type { TransportResponse } from "../fetch/transport.ts";
import type { ReadResult, ReadableStreamDefaultReader } from "../streams/readable.ts";

export class ResponseExceededMaxSizeError extends Error {
  readonly code = "UND_ERR_RES_EXCEEDED_MAX_SIZE";
  readonly maximumBytes: number;
  readonly receivedBytes: number;

  constructor(maximumBytes: number, receivedBytes: number) {
    super("Response content exceeded the configured limit of " + String(maximumBytes) + " bytes");
    this.name = "ResponseExceededMaxSizeError";
    this.maximumBytes = maximumBytes;
    this.receivedBytes = receivedBytes;
  }
}

export function validateResponseBodyLimit(maximumBytes: number): void {
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 1) {
    throw new RangeError("Response body limit must be a positive safe integer");
  }
}

function declaredContentLength(headers: readonly HeaderEntry[]): number | null {
  const value = new Headers(headers).get("content-length");
  if (value === null || !/^[0-9]+$/.test(value)) return null;
  const length = Number(value);
  return Number.isSafeInteger(length) ? length : Number.POSITIVE_INFINITY;
}

async function cancelWithoutMasking(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  reason: unknown,
): Promise<void> {
  try {
    await reader.cancel(reason);
  } catch {
    // The read/limit/abort reason remains the observable failure.
  }
}

async function readWithAbort(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  signal: AbortSignal,
): Promise<ReadResult<Uint8Array>> {
  signal.throwIfAborted();
  const result = Promise.withResolvers<ReadResult<Uint8Array>>();
  const unsubscribe = signal.subscribe(() => result.reject(signal.reason));
  reader.read().then(result.resolve, result.reject);
  try {
    return await result.promise;
  } finally {
    unsubscribe();
  }
}

export async function collectResponseBody(
  response: TransportResponse,
  signal: AbortSignal,
  maximumBytes: number,
): Promise<Uint8Array> {
  validateResponseBodyLimit(maximumBytes);
  signal.throwIfAborted();
  const declared = declaredContentLength(response.headers);
  if (declared !== null && declared > maximumBytes) {
    const error = new ResponseExceededMaxSizeError(maximumBytes, declared);
    if (response.body !== null) {
      try {
        await response.body.cancel(error);
      } catch {
        // The declared size violation remains the observable failure.
      }
    }
    if (response.trailers !== undefined) ignoreRejection(response.trailers);
    throw error;
  }
  if (response.body === null) return new Uint8Array(0);

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  try {
    while (true) {
      const item = await readWithAbort(reader, signal);
      if (item.done) return concatBytes(chunks, received);
      if (!(item.value instanceof Uint8Array)) {
        throw new TypeError("Transport response body chunks must be Uint8Array values");
      }
      received += item.value.length;
      if (received > maximumBytes) {
        throw new ResponseExceededMaxSizeError(maximumBytes, received);
      }
      chunks.push(item.value.slice());
    }
  } catch (error) {
    await cancelWithoutMasking(reader, error);
    if (response.trailers !== undefined) ignoreRejection(response.trailers);
    throw error;
  } finally {
    reader.releaseLock();
  }
}

export async function settleResponseTrailers(
  response: TransportResponse,
  signal: AbortSignal,
): Promise<readonly HeaderEntry[] | undefined> {
  const pending = response.trailers;
  if (pending === undefined) return undefined;
  signal.throwIfAborted();
  const result = Promise.withResolvers<readonly HeaderEntry[]>();
  const unsubscribe = signal.subscribe(() => result.reject(signal.reason));
  pending.then(result.resolve, result.reject);
  try {
    const entries = await result.promise;
    signal.throwIfAborted();
    const copy: HeaderEntry[] = [];
    for (const [name, value] of entries) copy.push([name, value]);
    return copy;
  } finally {
    unsubscribe();
  }
}
