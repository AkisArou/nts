/*---
description: "Returning from a private-field async consumer awaits close before consumer finally."
features: [ts-async-iteration-routes, ts-async-iteration-route-exits, ts-async, ts-async-generators, ts-iteration, ts-functions, ts-arrays, ts-numbers, ts-strings, ts-unknown, ts-class, ts-class-fields, ts-this, ts-symbols, ts-readonly, ts-generics, ts-null-undefined, ts-unions, ts-errors, ts-objects, ts-private-fields, ts-typeof-operator]
flags: [async]
---*/
// The iterable crosses a private field; node waits for return before the consumer finally and caller, preserving the selected value and closing only once.
const log: string[] = [];
class Source<T> implements AsyncIterableIterator<T, undefined, unknown> {
  items: readonly T[]; name: string; index: number = 0; closed: number = 0; fault: Error | undefined;
  constructor(items: readonly T[], name: string = "it", fault?: Error) { log.push("new:" + name); this.items = items; this.name = name; this.fault = fault; }
  [Symbol.asyncIterator](): AsyncIterableIterator<T, undefined, unknown> { log.push(this.name + ":iterator"); return this; }
  async next(): Promise<IteratorResult<T, undefined>> { log.push(this.name + ":next:" + this.index); return this.closed || this.index === this.items.length ? { done: true, value: undefined } : { done: false, value: this.items[this.index++] }; }
  async return(): Promise<IteratorResult<T, undefined>> { log.push(this.name + ":return:start"); this.closed++; await Promise.resolve(); if (this.fault !== undefined) { log.push(this.name + ":return:reject"); throw this.fault; } log.push(this.name + ":return:end"); return { done: true, value: undefined }; }
}
class Consumer {
  #source: AsyncIterable<number>; constructor(source: AsyncIterable<number>) { log.push("consumer:new"); this.#source = source; }
  async take(): Promise<number | undefined> { log.push("consume"); const source = this.#source;
    try { for await (const value of source) { log.push("body:" + value); return value; } log.push("empty"); return undefined; }
    finally { log.push("consumer:finally"); }
  }
}
async function main(): Promise<void> {
  for (const items of [[], [2], [5, 7, 9]]) {
    const cursor = new Source(items), consumer = new Consumer(cursor); log.length = 0;
    const value = await consumer.take(); log.push("caller");
    const expected = ["consume", "it:iterator", "it:next:0"];
    if (items.length > 0) expected.push("body:" + items[0], "it:return:start", "it:return:end"); else expected.push("empty"); expected.push("consumer:finally", "caller");
    assert.compareArray(log, expected); assert.sameValue(value, items[0]); assert.sameValue(typeof value, items.length === 0 ? "undefined" : "number");
    assert.sameValue(cursor.closed, items.length > 0 ? 1 : 0); assert.sameValue(cursor.index, items.length > 0 ? 1 : 0);
  }
}
main().then(() => $DONE(), (error: unknown) => $DONE(error));
