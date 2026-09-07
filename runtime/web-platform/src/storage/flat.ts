import type { AbortSignal } from "../core/abort.ts";
import { TextDecoder } from "../core/encoding.ts";
import type { BlobExternalReader, BlobExternalSource } from "../file/blob.ts";
import type { DurableByteStore, DurableRecord, DurableWrite } from "./durable.ts";

/**
 * The flat surface a provider exposes for a byte store.
 *
 * Synchronous scalars, strings and byte views, because that is what a foreign-function
 * boundary can carry. Everything the {@link DurableByteStore} contract adds on top of
 * it -- promises, an `AbortSignal` checked between chunks, a write as an object with a
 * lifetime -- is shared and lives in {@link durableStoreFromFlat}, so it is implemented
 * once rather than once per provider. A provider that reimplemented it would be
 * reimplementing the parts most likely to differ subtly between platforms.
 *
 * Buffers are caller-owned throughout, matching the rest of the intrinsic surface:
 * the caller allocates and the provider fills.
 */
export interface FlatDurableStore {
  /** A write handle, or -1 when the key already has a live write. */
  open(namespace: string, key: string): number;

  append(handle: number, from: Uint8Array): void;

  commit(handle: number): void;

  discard(handle: number): void;

  /** The value's full size, or -1 when absent. Writes `min(size, into.length)`. */
  read(namespace: string, key: string, into: Uint8Array): number;

  remove(namespace: string, key: string): boolean;

  /** Total bytes the records need. Writes `min(needed, into.length)`. */
  list(namespace: string, into: Uint8Array): number;

  size(namespace: string): number;

  /** A source handle, or -1 when absent. */
  sourceOpen(namespace: string, key: string, start: number, length: number): number;

  /** Bytes read, or -1 at the end. Never zero, so an empty chunk cannot occur. */
  sourceRead(handle: number, into: Uint8Array): number;

  sourceClose(handle: number): void;

  /** The value's size, or -1 when absent. */
  sourceSize(namespace: string, key: string): number;

  close(): void;
}

const INITIAL_BUFFER_BYTES = 4096;
const READ_CHUNK_BYTES = 64 * 1024;

/**
 * Fills a caller-owned buffer, growing once if the first guess was short.
 *
 * Both fill-buffer calls answer what there was and write what fits, so one retry is
 * always enough: the second buffer is the size the provider just reported. Guessing
 * again would be a loop with no bound.
 */
function fill(
  request: (into: Uint8Array) => number,
): { readonly bytes: Uint8Array<ArrayBuffer>; readonly length: number } | null {
  let buffer = new Uint8Array(new ArrayBuffer(INITIAL_BUFFER_BYTES));
  let needed = request(buffer);
  if (needed < 0) return null;
  if (needed > buffer.length) {
    buffer = new Uint8Array(new ArrayBuffer(needed));
    needed = request(buffer);
    if (needed < 0) return null;
  }
  return { bytes: buffer, length: needed };
}

/** Decimal digits terminated by NUL, as the record encoding writes them. */
function readNumber(bytes: Uint8Array, from: number): { value: number; next: number } {
  let value = 0;
  let index = from;
  while (index < bytes.length && bytes[index] !== 0) {
    const digit = (bytes[index] ?? 0) - 0x30;
    if (digit < 0 || digit > 9) throw new TypeError("Malformed durable record");
    value = value * 10 + digit;
    index++;
  }
  if (index >= bytes.length) throw new TypeError("Truncated durable record");
  return { value, next: index + 1 };
}

/**
 * Parses `size NUL modified NUL keyByteLength NUL key`, repeated.
 *
 * The explicit key length is what makes concatenation unambiguous: a key may contain
 * any byte, including the separator, so scanning for the next NUL after the key would
 * split a legal key in two.
 */
function parseRecords(bytes: Uint8Array, length: number): readonly DurableRecord[] {
  const decoder = new TextDecoder();
  const records: DurableRecord[] = [];
  let index = 0;
  while (index < length) {
    const size = readNumber(bytes, index);
    const modified = readNumber(bytes, size.next);
    const keyLength = readNumber(bytes, modified.next);
    const end = keyLength.next + keyLength.value;
    if (end > length) throw new TypeError("Truncated durable record key");
    records.push({
      key: decoder.decode(bytes.subarray(keyLength.next, end)),
      size: size.value,
      modifiedMilliseconds: modified.value,
    });
    index = end;
  }
  return records;
}

class FlatDurableWrite implements DurableWrite {
  readonly #flat: FlatDurableStore;
  readonly #handle: number;
  readonly #signal: AbortSignal;
  #settled = false;

  constructor(flat: FlatDurableStore, handle: number, signal: AbortSignal) {
    this.#flat = flat;
    this.#handle = handle;
    this.#signal = signal;
  }

  append(bytes: Uint8Array): Promise<void> {
    if (this.#settled) {
      return Promise.reject(new TypeError("This durable write has already settled"));
    }
    // Between chunks, which is where the contract says cancellation is honoured.
    if (this.#signal.aborted) return Promise.reject(this.#signal.reason);
    try {
      this.#flat.append(this.#handle, bytes);
    } catch (error) {
      return Promise.reject(error);
    }
    return Promise.resolve();
  }

  commit(): Promise<void> {
    if (this.#settled) return Promise.resolve();
    if (this.#signal.aborted) return Promise.reject(this.#signal.reason);
    this.#settled = true;
    try {
      this.#flat.commit(this.#handle);
    } catch (error) {
      return Promise.reject(error);
    }
    return Promise.resolve();
  }

  discard(): Promise<void> {
    if (this.#settled) return Promise.resolve();
    this.#settled = true;
    // Deliberately not signal-checked: discarding is the cleanup path and has to work
    // when the signal is already aborted, which is exactly when it is most needed.
    try {
      this.#flat.discard(this.#handle);
    } catch (error) {
      return Promise.reject(error);
    }
    return Promise.resolve();
  }
}

/**
 * Gives a provider's flat byte store the {@link DurableByteStore} shape.
 *
 * Portable on purpose: the flat surface is the same wherever a provider offers bytes,
 * so the promise, cancellation and handle-lifetime semantics are written once here and
 * a provider supplies twelve synchronous functions.
 */
export function durableStoreFromFlat(flat: FlatDurableStore): DurableByteStore {
  return {
    read(namespace: string, key: string, signal: AbortSignal): Promise<Uint8Array | null> {
      try {
        signal.throwIfAborted();
        const result = fill((into) => flat.read(namespace, key, into));
        if (result === null) return Promise.resolve(null);
        return Promise.resolve(result.bytes.subarray(0, result.length));
      } catch (error) {
        return Promise.reject(error);
      }
    },

    source(
      namespace: string,
      key: string,
      signal: AbortSignal,
    ): Promise<BlobExternalSource | null> {
      try {
        signal.throwIfAborted();
        const size = flat.sourceSize(namespace, key);
        if (size < 0) return Promise.resolve(null);
        return Promise.resolve({
          size,
          open(start: number, length: number): BlobExternalReader {
            const handle = flat.sourceOpen(namespace, key, start, length);
            let closed = handle < 0;
            return {
              read(maximumBytes: number): Promise<Uint8Array<ArrayBuffer> | undefined> {
                if (closed) {
                  return Promise.reject(new TypeError("The stored value is no longer readable"));
                }
                // Allocated per read. `BlobExternalReader` transfers ownership of each
                // chunk, so a consumer may keep two of them; a reused buffer would make
                // the older one change underneath it, and nothing would say so until a
                // consumer happened to keep both.
                const into = new Uint8Array(
                  new ArrayBuffer(Math.min(maximumBytes, READ_CHUNK_BYTES)),
                );
                let count: number;
                try {
                  count = flat.sourceRead(handle, into);
                } catch (error) {
                  return Promise.reject(error);
                }
                if (count < 0) return Promise.resolve(undefined);
                return Promise.resolve(into.subarray(0, count) as Uint8Array<ArrayBuffer>);
              },
              close(): Promise<void> {
                if (closed) return Promise.resolve();
                closed = true;
                try {
                  flat.sourceClose(handle);
                } catch (error) {
                  return Promise.reject(error);
                }
                return Promise.resolve();
              },
            };
          },
        });
      } catch (error) {
        return Promise.reject(error);
      }
    },

    write(namespace: string, key: string, signal: AbortSignal): Promise<DurableWrite> {
      try {
        signal.throwIfAborted();
        const handle = flat.open(namespace, key);
        if (handle < 0) {
          // Refused rather than queued, as the contract says; the provider reports it
          // because that is where the state lives.
          return Promise.reject(new TypeError("A write to this key is already open"));
        }
        return Promise.resolve(new FlatDurableWrite(flat, handle, signal));
      } catch (error) {
        return Promise.reject(error);
      }
    },

    delete(namespace: string, key: string, signal: AbortSignal): Promise<boolean> {
      try {
        signal.throwIfAborted();
        return Promise.resolve(flat.remove(namespace, key));
      } catch (error) {
        return Promise.reject(error);
      }
    },

    list(namespace: string, signal: AbortSignal): Promise<readonly DurableRecord[]> {
      try {
        signal.throwIfAborted();
        const result = fill((into) => flat.list(namespace, into));
        if (result === null) return Promise.resolve([]);
        return Promise.resolve(parseRecords(result.bytes, result.length));
      } catch (error) {
        return Promise.reject(error);
      }
    },

    size(namespace: string, signal: AbortSignal): Promise<number> {
      try {
        signal.throwIfAborted();
        return Promise.resolve(flat.size(namespace));
      } catch (error) {
        return Promise.reject(error);
      }
    },

    close(): Promise<void> {
      try {
        flat.close();
      } catch (error) {
        return Promise.reject(error);
      }
      return Promise.resolve();
    },
  };
}
