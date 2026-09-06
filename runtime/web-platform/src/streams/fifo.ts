/**
 * Allocation-bounded FIFO storage. A head index makes dequeue constant-time;
 * consumed references are cleared immediately, and the sparse prefix is
 * compacted only after a substantial majority is dead.
 */
export class Fifo<T extends object> {
  readonly #values: (T | undefined)[] = [];
  #head = 0;

  get empty(): boolean {
    return this.#head === this.#values.length;
  }

  get length(): number {
    return this.#values.length - this.#head;
  }

  enqueue(value: T): void {
    this.#values.push(value);
  }

  peek(): T | undefined {
    return this.#values[this.#head];
  }

  dequeue(): T | undefined {
    const value = this.peek();
    if (value === undefined) {
      return undefined;
    }
    this.#values[this.#head] = undefined;
    this.#head++;
    this.#compactIfNeeded();
    return value;
  }

  reset(): void {
    this.#values.length = 0;
    this.#head = 0;
  }

  #compactIfNeeded(): void {
    const values = this.#values;
    const head = this.#head;
    if (head === values.length) {
      values.length = 0;
      this.#head = 0;
      return;
    }
    if (head <= 1024 || head * 2 <= values.length) {
      return;
    }

    const remaining = values.length - head;
    for (let index = 0; index < remaining; index++) {
      const value = values[head + index];
      if (value !== undefined) {
        values[index] = value;
      }
    }
    values.length = remaining;
    this.#head = 0;
  }
}
