/*---
description: "A labeled continue closes only the inner async iterator and advances the private-field outer source."
features: [ts-async-iteration-routes, ts-async-iteration-route-exits, ts-async, ts-async-generators, ts-iteration, ts-functions, ts-arrays, ts-numbers, ts-strings, ts-unknown, ts-class, ts-class-fields, ts-this, ts-symbols, ts-readonly, ts-generics, ts-null-undefined, ts-unions, ts-errors, ts-objects, ts-private-fields]
flags: [async]
---*/
// A private field carries the outer source; node awaits each fresh inner return before the next outer step and never closes the continuing outer iterator.
const log: string[] = [];
class Source<T> implements AsyncIterableIterator<T, undefined, unknown> {
  items: readonly T[]; name: string; index: number = 0; closed: number = 0; fault: Error | undefined;
  constructor(items: readonly T[], name: string = "it", fault?: Error) { log.push("new:" + name); this.items = items; this.name = name; this.fault = fault; }
  [Symbol.asyncIterator](): AsyncIterableIterator<T, undefined, unknown> { log.push(this.name + ":iterator"); return this; }
  async next(): Promise<IteratorResult<T, undefined>> { log.push(this.name + ":next:" + this.index); return this.closed || this.index === this.items.length ? { done: true, value: undefined } : { done: false, value: this.items[this.index++] }; }
  async return(): Promise<IteratorResult<T, undefined>> { log.push(this.name + ":return:start"); this.closed++; await Promise.resolve(); if (this.fault !== undefined) { log.push(this.name + ":return:reject"); throw this.fault; } log.push(this.name + ":return:end"); return { done: true, value: undefined }; }
}
class Consumer {
  #source: AsyncIterable<number>; inners: Source<number>[] = [];
  constructor(source: AsyncIterable<number>) { log.push("consumer:new"); this.#source = source; }
  async run(): Promise<number[]> { log.push("consume"); const source = this.#source, seen: number[] = [];
    outer: for await (const value of source) { log.push("outer:body:" + value); const inner = new Source([value * 10, value * 10 + 1], "inner:" + value); this.inners.push(inner); const nested: AsyncIterable<number> = inner;
      for await (const part of nested) { log.push("inner:body:" + part); seen.push(part); log.push("continue"); continue outer; }
      log.push("outer:tail");
    }
    log.push("after"); return seen;
  }
}
async function main(): Promise<void> {
  for (const items of [[], [2], [5, 7, 9]]) {
    const cursor = new Source(items, "outer"), consumer = new Consumer(cursor); log.length = 0;
    const seen = await consumer.run(); log.push("caller"); const expected = ["consume", "outer:iterator"], values: number[] = [];
    for (let index = 0; index < items.length; index++) { const value = items[index], name = "inner:" + value; values.push(value * 10); expected.push("outer:next:" + index, "outer:body:" + value, "new:" + name, name + ":iterator", name + ":next:0", "inner:body:" + value * 10, "continue", name + ":return:start", name + ":return:end"); }
    expected.push("outer:next:" + items.length, "after", "caller");
    assert.compareArray(log, expected); assert.compareArray(seen, values); assert.sameValue(cursor.closed, 0); assert.sameValue(cursor.index, items.length); assert.sameValue(consumer.inners.length, items.length);
    for (const inner of consumer.inners) { assert.sameValue(inner.closed, 1); assert.sameValue(inner.index, 1); }
  }
}
main().then(() => $DONE(), (error: unknown) => $DONE(error));
