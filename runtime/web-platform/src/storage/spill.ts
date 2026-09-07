import { AbortController } from "../core/abort.ts";
import type { AbortSignal } from "../core/abort.ts";
import { LimitError } from "../core/errors.ts";
import { Blob, _createBlobFromExternalSource } from "../file/blob.ts";
import type { ReadableStream } from "../streams/readable.ts";
import type { DurableByteStore, DurableWrite } from "./durable.ts";

/**
 * A body that has been read to the end, held wherever it fits.
 *
 * The `blob` is the same value either way -- the point of the pairing is that a consumer
 * of a spilled body reads it through exactly the code that reads any other Blob. Only
 * `release` differs, and only in whether it has anything to do.
 */
export interface SpilledBody {
  readonly blob: Blob;

  /** True when the bytes are in the durable store rather than in memory. */
  readonly spilled: boolean;

  readonly size: number;

  /**
   * Removes whatever this spill wrote.
   *
   * Idempotent. The blob must not be read afterwards; a Blob has no disposal of its
   * own, so the lifetime belongs to whoever asked for the spill. That is deliberate:
   * the alternative is a finalizer deciding when stored bytes go away, and a cache of
   * spilled bodies would then be at the mercy of when collection happens to run.
   */
  release(): Promise<void>;
}

export interface DurableSpillAreaOptions {
  /** Defaults to `"spill"`. */
  namespace?: string;
  /** Bytes held in memory before anything is written. Defaults to 1 MiB. */
  memoryThresholdBytes?: number;
  /** Refused beyond this. Defaults to 512 MiB. */
  maxBytes?: number;
}

function validateLimit(value: number | undefined, fallback: number, name: string): number {
  const result = value ?? fallback;
  if (!Number.isSafeInteger(result) || result < 0) {
    throw new RangeError("Invalid spill " + name);
  }
  return result;
}

function joinChunks(chunks: readonly Uint8Array[], length: number): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(new ArrayBuffer(length));
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

/**
 * Scratch space in the durable store for bodies too large to hold in memory.
 *
 * The threshold is the whole design. A body under it never touches the store, so the
 * common case pays nothing; a body over it is written as it arrives and is never
 * assembled in memory at all, which is the requirement the streaming write side of the
 * byte store exists for. What comes back is a Blob either way.
 *
 * **Spilled bytes do not survive the process that wrote them.** {@link open} clears the
 * namespace, because anything left in it is from a run that has ended and nothing can
 * name it again. That makes the namespace unshareable with a store whose contents are
 * meant to last, which is why it is a namespace of its own rather than a key prefix.
 */
export class DurableSpillArea {
  readonly #store: DurableByteStore;
  readonly #namespace: string;
  readonly #memoryThresholdBytes: number;
  readonly #maxBytes: number;
  readonly #signal: AbortSignal;
  #nextId = 0;

  private constructor(store: DurableByteStore, options: DurableSpillAreaOptions) {
    this.#store = store;
    this.#namespace = options.namespace ?? "spill";
    this.#memoryThresholdBytes = validateLimit(
      options.memoryThresholdBytes,
      1024 * 1024,
      "memory threshold",
    );
    this.#maxBytes = validateLimit(options.maxBytes, 512 * 1024 * 1024, "byte limit");
    this.#signal = new AbortController().signal;
  }

  static async open(
    store: DurableByteStore,
    options: DurableSpillAreaOptions = {},
  ): Promise<DurableSpillArea> {
    const area = new DurableSpillArea(store, options);
    await area.clear();
    return area;
  }

  /** Discards every spilled body in the namespace. */
  async clear(): Promise<void> {
    for (const record of await this.#store.list(this.#namespace, this.#signal)) {
      await this.#store.delete(this.#namespace, record.key, this.#signal);
    }
  }

  #memoryBody(chunks: readonly Uint8Array[], length: number, type: string): SpilledBody {
    const blob = new Blob([joinChunks(chunks, length)], { type });
    return {
      blob,
      spilled: false,
      size: length,
      release(): Promise<void> {
        return Promise.resolve();
      },
    };
  }

  async #spilledBody(key: string, length: number, type: string): Promise<SpilledBody> {
    const source = await this.#store.source(this.#namespace, key, this.#signal);
    if (source === null) throw new TypeError("The spilled body vanished before it was read");
    const store = this.#store;
    const namespace = this.#namespace;
    const signal = this.#signal;
    let released = false;
    return {
      blob: _createBlobFromExternalSource(source, type),
      spilled: true,
      size: length,
      async release(): Promise<void> {
        if (released) return;
        released = true;
        await store.delete(namespace, key, signal);
      },
    };
  }

  /**
   * Reads `stream` to the end, spilling once it outgrows the threshold.
   *
   * The stream is cancelled and anything written is discarded if the limit is exceeded,
   * if `signal` aborts, or if the stream itself fails -- a partial body is never handed
   * back as a whole one, and a refusal never leaves bytes in the namespace.
   */
  async spill(
    stream: ReadableStream<Uint8Array>,
    signal: AbortSignal,
    type = "",
  ): Promise<SpilledBody> {
    signal.throwIfAborted();
    const key = String(this.#nextId++);
    const reader = stream.getReader();
    const held: Uint8Array[] = [];
    let length = 0;
    let write: DurableWrite | null = null;

    const abandon = async (reason: unknown): Promise<void> => {
      // Order matters only in that both must happen: the stream is cancelled so the
      // producer stops, and the write is discarded so no bytes are left named.
      await reader.cancel(reason).then(
        () => {},
        () => {},
      );
      if (write !== null) await write.discard();
      await this.#store.delete(this.#namespace, key, this.#signal);
    };

    try {
      for (;;) {
        const next = await reader.read();
        if (next.done) break;
        const chunk = next.value;
        if (chunk === undefined) continue;
        if (signal.aborted) throw signal.reason;
        if (length + chunk.length > this.#maxBytes) {
          throw new LimitError("Spilled body exceeded configured byte limit");
        }
        length += chunk.length;

        if (write === null && length > this.#memoryThresholdBytes) {
          // Crossing the threshold: everything held so far goes out in one append, and
          // nothing is held from here on. Assembling the whole body to write it would
          // defeat the reason for spilling.
          write = await this.#store.write(this.#namespace, key, this.#signal);
          for (const previous of held) await write.append(previous);
          held.length = 0;
        }

        if (write === null) held.push(chunk.slice());
        else await write.append(chunk);
      }
    } catch (error) {
      // One cleanup path for every way this can end badly -- the limit, the signal, and
      // the stream failing on its own. Three call sites would be three chances to leave
      // bytes in the namespace.
      await abandon(error);
      throw error;
    } finally {
      reader.releaseLock();
    }

    if (write === null) return this.#memoryBody(held, length, type);
    await write.commit();
    return this.#spilledBody(key, length, type);
  }
}
