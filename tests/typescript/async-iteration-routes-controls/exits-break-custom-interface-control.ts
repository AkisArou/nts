/*---
description: "Breaking async iteration closes a custom source once through two interface implementations. The control uses explicit steps."
features: [ts-async-iteration-routes, ts-async-iteration-route-exits, ts-async, ts-async-generators, ts-iteration, ts-functions, ts-arrays, ts-numbers, ts-strings, ts-unknown, ts-class, ts-class-fields, ts-this, ts-symbols, ts-readonly, ts-generics, ts-null-undefined, ts-unions, ts-errors, ts-objects, ts-interfaces]
flags: [async]
---*/
// A custom cursor and a forwarding class cross one Feed interface; node awaits one return before after-loop code and makes no close call for an empty source. The control spells out the same steps.
const log: string[] = [];
class Source<T> implements AsyncIterableIterator<T, undefined, unknown> {
  items: readonly T[]; name: string; index: number = 0; closed: number = 0; fault: Error | undefined;
  constructor(items: readonly T[], name: string = "it", fault?: Error) { log.push("new:" + name); this.items = items; this.name = name; this.fault = fault; }
  [Symbol.asyncIterator](): AsyncIterableIterator<T, undefined, unknown> { log.push(this.name + ":iterator"); return this; }
  async next(): Promise<IteratorResult<T, undefined>> { log.push(this.name + ":next:" + this.index); return this.closed || this.index === this.items.length ? { done: true, value: undefined } : { done: false, value: this.items[this.index++] }; }
  async return(): Promise<IteratorResult<T, undefined>> { log.push(this.name + ":return:start"); this.closed++; await Promise.resolve(); if (this.fault !== undefined) { log.push(this.name + ":return:reject"); throw this.fault; } log.push(this.name + ":return:end"); return { done: true, value: undefined }; }
}
interface Feed extends AsyncIterable<number> {}
class Wrapped implements Feed {
  inner: Source<number>; constructor(inner: Source<number>) { log.push("wrap:new"); this.inner = inner; }
  [Symbol.asyncIterator](): AsyncIterator<number> { log.push("wrap:iterator"); return this.inner[Symbol.asyncIterator](); }
}
async function consume(source: Feed): Promise<number[]> { log.push("consume"); const seen: number[] = [];
  const iterator = source[Symbol.asyncIterator]();
  while (true) { const step = await iterator.next(); if (step.done) break; const value = step.value; log.push("body:" + value); seen.push(value); const close = iterator.return; if (close !== undefined) await close.call(iterator); break; }
  log.push("after"); return seen;
}
async function main(): Promise<void> {
  for (const items of [[], [2], [5, 7, 9]]) for (const wrapped of [false, true]) {
    const cursor = new Source(items), source: Feed = wrapped ? new Wrapped(cursor) : cursor;
    log.length = 0; const seen = await consume(source); log.push("caller");
    const expected = ["consume"]; if (wrapped) expected.push("wrap:iterator"); expected.push("it:iterator", "it:next:0");
    if (items.length > 0) expected.push("body:" + items[0], "it:return:start", "it:return:end"); expected.push("after", "caller");
    assert.compareArray(log, expected); assert.compareArray(seen, items.slice(0, 1));
    assert.sameValue(cursor.closed, items.length > 0 ? 1 : 0); assert.sameValue(cursor.index, items.length > 0 ? 1 : 0);
  }
}
main().then(() => $DONE(), (error: unknown) => $DONE(error));
