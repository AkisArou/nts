export interface ValueWithSize<T> {
  readonly value: T;
  readonly size: number;
}

/**
 * The Streams Standard's queue-with-sizes, represented with a head index so a
 * dequeue never shifts the remainder of a burst. The running IEEE-754 total is
 * intentionally not recomputed from the entries: its rounding history is
 * observable through `desiredSize`.
 */
export class QueueWithSizes<T> {
  readonly #entries: ValueWithSize<T>[] = [];
  #head = 0;
  #totalSize = 0;

  get empty(): boolean {
    return this.#head === this.#entries.length;
  }

  get length(): number {
    return this.#entries.length - this.#head;
  }

  get totalSize(): number {
    return this.#totalSize;
  }

  enqueue(value: T, size: number): void {
    const convertedSize = +size;
    if (!Number.isFinite(convertedSize) || convertedSize < 0) {
      throw new RangeError("Invalid stream chunk size");
    }
    this.#entries.push({ value, size: convertedSize });
    this.#totalSize += convertedSize;
  }

  peek(): ValueWithSize<T> | undefined {
    return this.#entries[this.#head];
  }

  dequeue(): ValueWithSize<T> | undefined {
    const entry = this.#entries[this.#head];
    if (entry === undefined) {
      return undefined;
    }

    this.#head++;
    this.#totalSize -= entry.size;
    if (this.#totalSize < 0) {
      this.#totalSize = 0;
    }
    this.#compactIfNeeded();
    return entry;
  }

  reset(): void {
    this.#entries.length = 0;
    this.#head = 0;
    this.#totalSize = 0;
  }

  #compactIfNeeded(): void {
    const entries = this.#entries;
    const head = this.#head;
    if (head === entries.length) {
      entries.length = 0;
      this.#head = 0;
      return;
    }
    if (head <= 1024 || head * 2 <= entries.length) {
      return;
    }

    const remaining = entries.length - head;
    for (let index = 0; index < remaining; index++) {
      const entry = entries[head + index];
      if (entry !== undefined) {
        entries[index] = entry;
      }
    }
    entries.length = remaining;
    this.#head = 0;
  }
}
