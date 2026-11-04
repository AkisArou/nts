/*---
description: "A body throw wins over a rejected async close through a captured source binding."
features: [ts-async-iteration-routes, ts-async-iteration-route-exits, ts-async, ts-async-generators, ts-iteration, ts-functions, ts-arrays, ts-numbers, ts-strings, ts-unknown, ts-class, ts-class-fields, ts-this, ts-symbols, ts-readonly, ts-generics, ts-null-undefined, ts-unions, ts-errors, ts-objects, ts-closures, ts-instanceof]
flags: [async]
---*/
// A captured let carries the custom source; node awaits its rejecting return but keeps the body TypeError instead of the close RangeError.
const log: string[] = [];
class Source<T> implements AsyncIterableIterator<T, undefined, unknown> {
  items: readonly T[]; name: string; index: number = 0; closed: number = 0; fault: Error | undefined;
  constructor(items: readonly T[], name: string = "it", fault?: Error) { log.push("new:" + name); this.items = items; this.name = name; this.fault = fault; }
  [Symbol.asyncIterator](): AsyncIterableIterator<T, undefined, unknown> { log.push(this.name + ":iterator"); return this; }
  async next(): Promise<IteratorResult<T, undefined>> { log.push(this.name + ":next:" + this.index); return this.closed || this.index === this.items.length ? { done: true, value: undefined } : { done: false, value: this.items[this.index++] }; }
  async return(): Promise<IteratorResult<T, undefined>> { log.push(this.name + ":return:start"); this.closed++; await Promise.resolve(); if (this.fault !== undefined) { log.push(this.name + ":return:reject"); throw this.fault; } log.push(this.name + ":return:end"); return { done: true, value: undefined }; }
}
let selected: AsyncIterable<number> = new Source<number>([]);
async function consume(failure: Error, seen: number[]): Promise<void> { log.push("consume"); const source = selected;
  for await (const value of source) { log.push("body:" + value); seen.push(value); throw failure; }
  log.push("after-loop");
}
async function main(): Promise<void> {
  for (const items of [[2], [5, 7, 9]]) {
    const bodyError = new TypeError("body"), closeError = new RangeError("close"), cursor = new Source(items, "it", closeError), seen: number[] = []; let caught: unknown;
    selected = cursor; log.length = 0; try { await consume(bodyError, seen); } catch (error: unknown) { caught = error; log.push("caught"); } log.push("caller");
    assert.compareArray(log, ["consume", "it:iterator", "it:next:0", "body:" + items[0], "it:return:start", "it:return:reject", "caught", "caller"]);
    assert.compareArray(seen, items.slice(0, 1)); assert.sameValue(caught, bodyError); assert.sameValue(caught instanceof TypeError, true); assert.sameValue(caught === closeError, false);
    assert.sameValue(cursor.closed, 1); assert.sameValue(cursor.index, 1); assert.sameValue(selected, cursor);
  }
}
main().then(() => $DONE(), (error: unknown) => $DONE(error));
