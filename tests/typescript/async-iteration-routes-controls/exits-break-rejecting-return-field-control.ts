/*---
description: "A rejecting return replaces break through a class-held async source. The control uses explicit steps."
features: [ts-async-iteration-routes, ts-async-iteration-route-exits, ts-async, ts-async-generators, ts-iteration, ts-functions, ts-arrays, ts-numbers, ts-strings, ts-unknown, ts-class, ts-class-fields, ts-this, ts-symbols, ts-readonly, ts-generics, ts-null-undefined, ts-unions, ts-errors, ts-objects, ts-instanceof]
flags: [async]
---*/
// The source crosses a class field; node awaits its rejecting return, skips after-loop code, and reports the same RangeError outside the consumer. The control spells out the same steps.
const log: string[] = [];
class Source<T> implements AsyncIterableIterator<T, undefined, unknown> {
  items: readonly T[]; name: string; index: number = 0; closed: number = 0; fault: Error | undefined;
  constructor(items: readonly T[], name: string = "it", fault?: Error) { log.push("new:" + name); this.items = items; this.name = name; this.fault = fault; }
  [Symbol.asyncIterator](): AsyncIterableIterator<T, undefined, unknown> { log.push(this.name + ":iterator"); return this; }
  async next(): Promise<IteratorResult<T, undefined>> { log.push(this.name + ":next:" + this.index); return this.closed || this.index === this.items.length ? { done: true, value: undefined } : { done: false, value: this.items[this.index++] }; }
  async return(): Promise<IteratorResult<T, undefined>> { log.push(this.name + ":return:start"); this.closed++; await Promise.resolve(); if (this.fault !== undefined) { log.push(this.name + ":return:reject"); throw this.fault; } log.push(this.name + ":return:end"); return { done: true, value: undefined }; }
}
class Consumer {
  source: AsyncIterable<number>; constructor(source: AsyncIterable<number>) { log.push("consumer:new"); this.source = source; }
  async take(seen: number[]): Promise<void> { log.push("consume"); const source = this.source;
    const iterator = source[Symbol.asyncIterator]();
    while (true) { const step = await iterator.next(); if (step.done) break; const value = step.value; log.push("body:" + value); seen.push(value); const close = iterator.return; if (close !== undefined) await close.call(iterator); break; }
    log.push("after-loop");
  }
}
async function main(): Promise<void> {
  for (const items of [[2], [5, 7, 9]]) {
    const failure = new RangeError("close"), cursor = new Source(items, "it", failure), consumer = new Consumer(cursor), seen: number[] = []; let caught: unknown; log.length = 0;
    try { await consumer.take(seen); } catch (error: unknown) { caught = error; log.push("caught"); } log.push("caller");
    assert.compareArray(log, ["consume", "it:iterator", "it:next:0", "body:" + items[0], "it:return:start", "it:return:reject", "caught", "caller"]);
    assert.compareArray(seen, items.slice(0, 1)); assert.sameValue(caught, failure); assert.sameValue(caught instanceof RangeError, true);
    assert.sameValue(cursor.closed, 1); assert.sameValue(cursor.index, 1); assert.sameValue(consumer.source, cursor);
  }
}
main().then(() => $DONE(), (error: unknown) => $DONE(error));
