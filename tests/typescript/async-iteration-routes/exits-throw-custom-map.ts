/*---
description: "A body throw through a Map-held async source waits for closing before the outside catch."
features: [ts-async-iteration-routes, ts-async-iteration-route-exits, ts-async, ts-async-generators, ts-iteration, ts-functions, ts-arrays, ts-numbers, ts-strings, ts-unknown, ts-class, ts-class-fields, ts-this, ts-symbols, ts-readonly, ts-generics, ts-null-undefined, ts-unions, ts-errors, ts-objects, ts-map-set, ts-instanceof]
flags: [async]
---*/
// A checked Map lookup carries the custom async iterable; node runs and awaits return before the outside catch and preserves the exact body RangeError.
const log: string[] = [];
class Source<T> implements AsyncIterableIterator<T, undefined, unknown> {
  items: readonly T[]; name: string; index: number = 0; closed: number = 0; fault: Error | undefined;
  constructor(items: readonly T[], name: string = "it", fault?: Error) { log.push("new:" + name); this.items = items; this.name = name; this.fault = fault; }
  [Symbol.asyncIterator](): AsyncIterableIterator<T, undefined, unknown> { log.push(this.name + ":iterator"); return this; }
  async next(): Promise<IteratorResult<T, undefined>> { log.push(this.name + ":next:" + this.index); return this.closed || this.index === this.items.length ? { done: true, value: undefined } : { done: false, value: this.items[this.index++] }; }
  async return(): Promise<IteratorResult<T, undefined>> { log.push(this.name + ":return:start"); this.closed++; await Promise.resolve(); if (this.fault !== undefined) { log.push(this.name + ":return:reject"); throw this.fault; } log.push(this.name + ":return:end"); return { done: true, value: undefined }; }
}
async function consume(table: Map<string, AsyncIterable<number>>, failure: Error): Promise<void> {
  log.push("consume"); const source = table.get("active"); if (source === undefined) throw new Test262Error("missing source");
  for await (const value of source) { log.push("body:" + value); throw failure; }
  log.push("after-loop");
}
async function main(): Promise<void> {
  for (const items of [[2], [5, 7, 9]]) {
    const cursor = new Source(items), table = new Map<string, AsyncIterable<number>>([["active", cursor]]), failure = new RangeError("body"); let caught: unknown;
    log.length = 0; try { await consume(table, failure); } catch (error: unknown) { caught = error; log.push("caught"); } log.push("caller");
    assert.compareArray(log, ["consume", "it:iterator", "it:next:0", "body:" + items[0], "it:return:start", "it:return:end", "caught", "caller"]);
    assert.sameValue(caught, failure); assert.sameValue(caught instanceof RangeError, true); assert.sameValue(cursor.closed, 1); assert.sameValue(cursor.index, 1);
    assert.sameValue(table.get("active"), cursor);
  }
}
main().then(() => $DONE(), (error: unknown) => $DONE(error));
