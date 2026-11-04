/*---
description: "An inner async break completes closing before the Map-carried outer body continues. The control uses explicit steps."
features: [ts-async-iteration-routes, ts-async-iteration-route-exits, ts-async, ts-async-generators, ts-iteration, ts-functions, ts-arrays, ts-numbers, ts-strings, ts-unknown, ts-class, ts-class-fields, ts-this, ts-symbols, ts-readonly, ts-generics, ts-null-undefined, ts-unions, ts-errors, ts-objects, ts-map-set]
flags: [async]
---*/
// A checked Map value carries the outer source; node closes each fresh inner iterator before the outer tail and advances the outer source to exhaustion without closing it. The control spells out the same steps.
const log: string[] = [];
class Source<T> implements AsyncIterableIterator<T, undefined, unknown> {
  items: readonly T[]; name: string; index: number = 0; closed: number = 0; fault: Error | undefined;
  constructor(items: readonly T[], name: string = "it", fault?: Error) { log.push("new:" + name); this.items = items; this.name = name; this.fault = fault; }
  [Symbol.asyncIterator](): AsyncIterableIterator<T, undefined, unknown> { log.push(this.name + ":iterator"); return this; }
  async next(): Promise<IteratorResult<T, undefined>> { log.push(this.name + ":next:" + this.index); return this.closed || this.index === this.items.length ? { done: true, value: undefined } : { done: false, value: this.items[this.index++] }; }
  async return(): Promise<IteratorResult<T, undefined>> { log.push(this.name + ":return:start"); this.closed++; await Promise.resolve(); if (this.fault !== undefined) { log.push(this.name + ":return:reject"); throw this.fault; } log.push(this.name + ":return:end"); return { done: true, value: undefined }; }
}
async function consume(table: Map<string, AsyncIterable<number>>, inners: Source<number>[]): Promise<number[]> {
  log.push("consume"); const source = table.get("outer"); if (source === undefined) throw new Test262Error("missing source"); const seen: number[] = [];
  const outerIterator = source[Symbol.asyncIterator]();
  while (true) { const step = await outerIterator.next(); if (step.done) break; const value = step.value; log.push("outer:body:" + value); const inner = new Source([value + 1, value + 2], "inner:" + value); inners.push(inner); const nested: AsyncIterable<number> = inner;
    const innerIterator = nested[Symbol.asyncIterator]();
    while (true) { const step = await innerIterator.next(); if (step.done) break; const part = step.value; log.push("inner:body:" + part); seen.push(part); const close = innerIterator.return; if (close !== undefined) await close.call(innerIterator); break; }
    log.push("outer:tail:" + value);
  }
  log.push("after"); return seen;
}
async function main(): Promise<void> {
  for (const items of [[], [2], [5, 7, 9]]) {
    const cursor = new Source(items, "outer"), table = new Map<string, AsyncIterable<number>>([["outer", cursor]]), inners: Source<number>[] = []; log.length = 0;
    const seen = await consume(table, inners); log.push("caller"); const expected = ["consume", "outer:iterator"], values: number[] = [];
    for (let index = 0; index < items.length; index++) { const value = items[index], name = "inner:" + value; values.push(value + 1); expected.push("outer:next:" + index, "outer:body:" + value, "new:" + name, name + ":iterator", name + ":next:0", "inner:body:" + (value + 1), name + ":return:start", name + ":return:end", "outer:tail:" + value); }
    expected.push("outer:next:" + items.length, "after", "caller");
    assert.compareArray(log, expected); assert.compareArray(seen, values); assert.sameValue(cursor.closed, 0); assert.sameValue(cursor.index, items.length); assert.sameValue(inners.length, items.length);
    for (const inner of inners) { assert.sameValue(inner.closed, 1); assert.sameValue(inner.index, 1); } assert.sameValue(table.get("outer"), cursor);
  }
}
main().then(() => $DONE(), (error: unknown) => $DONE(error));
