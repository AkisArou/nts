// expect: emit-c --napi -> an object type with no layout
//
// Two of the web-platform blocker's six backend declines, reduced
// (2026-10-27): streams/fifo.ts:56, in Fifo#compactIfNeeded. The queue
// holds ValueWithSize<T> records inside a generic QueueWithSizes<T>
// inside a generic owner, so the copies the backend must emit still
// have T as an uninstantiated parameter and the record type has no
// layout (two such types in the platform, one per generic layer).
// Unlike the other declines in this family nothing here is refused in
// lowering first: the layout is simply never materialised. The JVM is
// the exception measured at record time: it materialises the record and
// this program agrees there. The concrete-specialised control agrees
// everywhere: a-fifo-of-concrete-records-inside-a-concrete-queue.

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
export interface ValueWithSize<T> { readonly value: T; readonly size: number; }
export class QueueWithSizes<T> {
  readonly #entries = new Fifo<ValueWithSize<T>>();
  #totalSize = 0;
  enqueue(value: T, size: number): void {
    this.#entries.enqueue({ value, size });
    this.#totalSize += size;
  }
  dequeue(): ValueWithSize<T> | undefined {
    const entry = this.#entries.dequeue();
    if (entry === undefined) return undefined;
    this.#totalSize -= entry.size;
    return entry;
  }
}
class State<T> {
  readonly #queue = new QueueWithSizes<T>();
  put(v: T): void { this.#queue.enqueue(v, 1); }
  take(): T | undefined { return this.#queue.dequeue()?.value; }
}
export function run(seed: number): number {
  const s = new State<string>();
  s.put("a"); s.put("bb"); s.put("ccc"); s.put("dddd");
  let t = 0;
  for (let i = 0; i < 4; i++) { const v = s.take(); if (v !== undefined) t += v.length; }
  return t + ((seed | 0) & 1);
}
