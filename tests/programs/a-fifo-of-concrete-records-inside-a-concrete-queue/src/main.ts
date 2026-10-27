// The control for a-fifo-of-generic-records-inside-a-generic-queue
// (tests/refusals): the same program specialised to string records, so
// every element type has a layout. Agrees everywhere.

export class Fifo<T extends object> {
  readonly #values: (T | undefined)[] = [];
  #head = 0;
  enqueue(value: T): void { this.#values.push(value); }
  peek(): T | undefined { return this.#values[this.#head]; }
  dequeue(): T | undefined {
    const value = this.peek();
    if (value === undefined) return undefined;
    this.#values[this.#head] = undefined;
    this.#head++;
    this.#compactIfNeeded();
    return value;
  }
  #compactIfNeeded(): void {
    const values = this.#values;
    const head = this.#head;
    if (head === values.length) { values.length = 0; this.#head = 0; return; }
    if (head <= 2 || head * 2 <= values.length) return;
    const remaining = values.length - head;
    for (let index = 0; index < remaining; index++) {
      const value = values[head + index];
      if (value !== undefined) values[index] = value;
    }
    values.length = remaining;
    this.#head = 0;
  }
}
export interface StringWithSize { readonly value: string; readonly size: number; }
export class StringQueueWithSizes {
  readonly #entries = new Fifo<StringWithSize>();
  #totalSize = 0;
  enqueue(value: string, size: number): void {
    this.#entries.enqueue({ value, size });
    this.#totalSize += size;
  }
  dequeue(): StringWithSize | undefined {
    const entry = this.#entries.dequeue();
    if (entry === undefined) return undefined;
    this.#totalSize -= entry.size;
    return entry;
  }
}
class State {
  readonly #queue = new StringQueueWithSizes();
  put(v: string): void { this.#queue.enqueue(v, 1); }
  take(): string | undefined { return this.#queue.dequeue()?.value; }
}
export function run(seed: number): number {
  const s = new State();
  s.put("a"); s.put("bb"); s.put("ccc"); s.put("dddd");
  let t = 0;
  for (let i = 0; i < 4; i++) { const v = s.take(); if (v !== undefined) t += v.length; }
  return t + ((seed | 0) & 1);
}
