// O(1) FIFO used by the iterator-stream queues. Capacity is always a power of
// two, so wrapping is one mask operation and removing the head never copies
// the remaining entries.

export class RingBuffer<T> {
  #backing: Array<T | undefined>;
  #head = 0;
  #size = 0;
  #mask: number;

  constructor(initialCapacity = 16) {
    this.#backing = new Array<T | undefined>(initialCapacity);
    this.#mask = initialCapacity - 1;
  }

  get length(): number {
    return this.#size;
  }

  push(item: T): void {
    if (this.#size > this.#mask) this.#grow();
    this.#backing[(this.#head + this.#size) & this.#mask] = item;
    this.#size++;
  }

  unshift(item: T): void {
    if (this.#size > this.#mask) this.#grow();
    this.#head = (this.#head - 1) & this.#mask;
    this.#backing[this.#head] = item;
    this.#size++;
  }

  shift(): T | undefined {
    if (this.#size === 0) return undefined;
    const item = this.#backing[this.#head];
    this.#backing[this.#head] = undefined;
    this.#head = (this.#head + 1) & this.#mask;
    this.#size--;
    return item;
  }

  get(index: number): T | undefined {
    if (index < 0 || index >= this.#size) return undefined;
    return this.#backing[(this.#head + index) & this.#mask];
  }

  indexOf(item: T): number {
    for (let i = 0; i < this.#size; i++) {
      if (this.#backing[(this.#head + i) & this.#mask] === item) return i;
    }
    return -1;
  }

  removeAt(index: number): void {
    if (index < 0 || index >= this.#size) return;
    for (let i = index; i < this.#size - 1; i++) {
      const from = (this.#head + i + 1) & this.#mask;
      const to = (this.#head + i) & this.#mask;
      this.#backing[to] = this.#backing[from];
    }
    this.#backing[(this.#head + this.#size - 1) & this.#mask] = undefined;
    this.#size--;
  }

  trimFront(count: number): void {
    const removed = Math.min(Math.max(count, 0), this.#size);
    for (let i = 0; i < removed; i++) {
      this.#backing[(this.#head + i) & this.#mask] = undefined;
    }
    this.#head = (this.#head + removed) & this.#mask;
    this.#size -= removed;
    if (this.#size === 0) this.#head = 0;
  }

  clear(): void {
    for (let i = 0; i < this.#size; i++) {
      this.#backing[(this.#head + i) & this.#mask] = undefined;
    }
    this.#head = 0;
    this.#size = 0;
  }

  #grow(): void {
    const capacity = (this.#mask + 1) * 2;
    const backing = new Array<T | undefined>(capacity);
    for (let i = 0; i < this.#size; i++) {
      backing[i] = this.#backing[(this.#head + i) & this.#mask];
    }
    this.#backing = backing;
    this.#head = 0;
    this.#mask = capacity - 1;
  }
}
