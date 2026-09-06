import { Fifo } from "./fifo.ts";

export interface ValueWithSize<T> {
  readonly value: T;
  readonly size: number;
}

/**
 * The Streams Standard's queue-with-sizes, represented with a head index so a
 * dequeue never shifts the remainder of a burst. Consumed references are
 * cleared immediately even when the sparse prefix is retained for amortized
 * compaction. The running IEEE-754 total is intentionally not recomputed from
 * the entries: its rounding history is observable through `desiredSize`.
 */
export class QueueWithSizes<T> {
  readonly #entries = new Fifo<ValueWithSize<T>>();
  #totalSize = 0;

  get empty(): boolean {
    return this.#entries.empty;
  }

  get length(): number {
    return this.#entries.length;
  }

  get totalSize(): number {
    return this.#totalSize;
  }

  enqueue(value: T, size: number): void {
    const convertedSize = +size;
    if (!Number.isFinite(convertedSize) || convertedSize < 0) {
      throw new RangeError("Invalid stream chunk size");
    }
    this.#entries.enqueue({ value, size: convertedSize });
    this.#totalSize += convertedSize;
  }

  peek(): ValueWithSize<T> | undefined {
    return this.#entries.peek();
  }

  dequeue(): ValueWithSize<T> | undefined {
    const entry = this.#entries.dequeue();
    if (entry === undefined) {
      return undefined;
    }

    this.#totalSize -= entry.size;
    if (this.#totalSize < 0) {
      this.#totalSize = 0;
    }
    return entry;
  }

  reset(): void {
    this.#entries.reset();
    this.#totalSize = 0;
  }
}
