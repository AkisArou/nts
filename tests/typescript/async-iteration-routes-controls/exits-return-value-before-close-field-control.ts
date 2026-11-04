/*---
description: "An enclosing return saves its value before awaited closing mutates the source field. The control uses explicit steps."
features: [ts-async-iteration-routes, ts-async-iteration-route-exits, ts-async, ts-async-generators, ts-iteration, ts-functions, ts-arrays, ts-numbers, ts-strings, ts-unknown, ts-class, ts-class-fields, ts-this, ts-symbols, ts-readonly, ts-generics, ts-null-undefined, ts-unions, ts-errors, ts-objects]
flags: [async]
---*/
// A class field carries the source into a returning consumer; node evaluates the return expression first, then awaits the close mutation before the caller runs. The control spells out the same steps.
const log: string[] = [];
class Source<T> implements AsyncIterableIterator<T, undefined, unknown> {
  items: readonly T[]; name: string; index: number = 0; closed: number = 0; fault: Error | undefined; current: number = 0;
  constructor(items: readonly T[], name: string = "it", fault?: Error) { log.push("new:" + name); this.items = items; this.name = name; this.fault = fault; }
  [Symbol.asyncIterator](): AsyncIterableIterator<T, undefined, unknown> { log.push(this.name + ":iterator"); return this; }
  async next(): Promise<IteratorResult<T, undefined>> { log.push(this.name + ":next:" + this.index); return this.closed || this.index === this.items.length ? { done: true, value: undefined } : { done: false, value: this.items[this.index++] }; }
  async return(): Promise<IteratorResult<T, undefined>> { log.push(this.name + ":return:start"); this.closed++; await Promise.resolve(); this.current += 100; if (this.fault !== undefined) { log.push(this.name + ":return:reject"); throw this.fault; } log.push(this.name + ":return:end"); return { done: true, value: undefined }; }
}
class Consumer {
  source: Source<number>; constructor(source: Source<number>) { log.push("consumer:new"); this.source = source; }
  async take(): Promise<number> { log.push("consume"); const source = this.source;
    const iterator = source[Symbol.asyncIterator]();
    while (true) { const step = await iterator.next(); if (step.done) break; const value = step.value; log.push("body:" + value, "return-value:" + source.current); const result = source.current; const close = iterator.return; if (close !== undefined) await close.call(iterator); return result; }
    return -1;
  }
}
async function main(): Promise<void> {
  for (const initial of [0, 7]) for (const items of [[2], [5, 7, 9]]) {
    const cursor = new Source(items), consumer = new Consumer(cursor); cursor.current = initial; log.length = 0;
    const value = await consumer.take(); log.push("caller:" + cursor.current);
    assert.compareArray(log, ["consume", "it:iterator", "it:next:0", "body:" + items[0], "return-value:" + initial, "it:return:start", "it:return:end", "caller:" + (initial + 100)]);
    assert.sameValue(value, initial); assert.sameValue(cursor.current, initial + 100); assert.sameValue(cursor.closed, 1); assert.sameValue(cursor.index, 1); assert.sameValue(consumer.source, cursor);
  }
}
main().then(() => $DONE(), (error: unknown) => $DONE(error));
