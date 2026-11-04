/*---
description: "Continuing async iteration through a readonly source array never closes the iterator."
features: [ts-async-iteration-routes, ts-async-iteration-route-exits, ts-async, ts-async-generators, ts-iteration, ts-functions, ts-arrays, ts-numbers, ts-strings, ts-unknown, ts-class, ts-class-fields, ts-this, ts-symbols, ts-readonly, ts-generics, ts-null-undefined, ts-unions, ts-errors, ts-objects]
flags: [async]
---*/
// A readonly array element carries the custom async source; node advances after each continue, runs only the noncontinued tails, and never calls return.
const log: string[] = [];
class Source<T> implements AsyncIterableIterator<T, undefined, unknown> {
  items: readonly T[]; name: string; index: number = 0; closed: number = 0; fault: Error | undefined;
  constructor(items: readonly T[], name: string = "it", fault?: Error) { log.push("new:" + name); this.items = items; this.name = name; this.fault = fault; }
  [Symbol.asyncIterator](): AsyncIterableIterator<T, undefined, unknown> { log.push(this.name + ":iterator"); return this; }
  async next(): Promise<IteratorResult<T, undefined>> { log.push(this.name + ":next:" + this.index); return this.closed || this.index === this.items.length ? { done: true, value: undefined } : { done: false, value: this.items[this.index++] }; }
  async return(): Promise<IteratorResult<T, undefined>> { log.push(this.name + ":return:start"); this.closed++; await Promise.resolve(); if (this.fault !== undefined) { log.push(this.name + ":return:reject"); throw this.fault; } log.push(this.name + ":return:end"); return { done: true, value: undefined }; }
}
async function consume(sources: readonly AsyncIterable<number>[]): Promise<number[]> { log.push("consume"); const source = sources[0], seen: number[] = []; let index = 0;
  for await (const value of source) { log.push("body:" + value); seen.push(value); if (index++ % 2 === 0) { log.push("continue"); continue; } log.push("tail"); }
  log.push("after"); return seen;
}
async function main(): Promise<void> {
  for (const items of [[], [2], [5, 7, 9]]) {
    const cursor = new Source(items), sources: readonly AsyncIterable<number>[] = [cursor]; log.length = 0;
    const seen = await consume(sources); log.push("caller"); const expected = ["consume", "it:iterator"];
    for (let index = 0; index < items.length; index++) expected.push("it:next:" + index, "body:" + items[index], index % 2 === 0 ? "continue" : "tail"); expected.push("it:next:" + items.length, "after", "caller");
    assert.compareArray(log, expected); assert.compareArray(seen, items); assert.sameValue(cursor.closed, 0); assert.sameValue(cursor.index, items.length); assert.sameValue(sources[0], cursor);
  }
}
main().then(() => $DONE(), (error: unknown) => $DONE(error));
