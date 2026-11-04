/*---
description: "Breaking a narrowed async source with no return leaves its remaining values available. The control uses explicit steps."
features: [ts-async-iteration-routes, ts-async-iteration-route-exits, ts-async, ts-async-generators, ts-iteration, ts-functions, ts-arrays, ts-numbers, ts-strings, ts-unknown, ts-class, ts-class-fields, ts-this, ts-symbols, ts-readonly, ts-generics, ts-null-undefined, ts-unions, ts-errors, ts-objects, ts-type-aliases, ts-narrowing, ts-discriminated-unions]
flags: [async]
---*/
// A discriminated union carries an iterator without return; node simply leaves it on break, and a second loop reads only the remaining values. The control spells out the same steps.
const log: string[] = [];
class Source<T> implements AsyncIterableIterator<T, undefined, unknown> {
  items: readonly T[]; name: string; index: number = 0; closed: number = 0; fault: Error | undefined;
  constructor(items: readonly T[], name: string = "it", fault?: Error) { log.push("new:" + name); this.items = items; this.name = name; this.fault = fault; }
  [Symbol.asyncIterator](): AsyncIterableIterator<T, undefined, unknown> { log.push(this.name + ":iterator"); return this; }
  async next(): Promise<IteratorResult<T, undefined>> { log.push(this.name + ":next:" + this.index); return this.closed || this.index === this.items.length ? { done: true, value: undefined } : { done: false, value: this.items[this.index++] }; }
}
type Route = { kind: "direct"; cursor: AsyncIterable<number> } | { kind: "boxed"; box: { cursor: AsyncIterable<number> } };
async function consume(route: Route): Promise<number[][]> { log.push("consume"); const source = route.kind === "direct" ? route.cursor : route.box.cursor, first: number[] = [], rest: number[] = [];
  const firstIterator = source[Symbol.asyncIterator]();
  while (true) { const step = await firstIterator.next(); if (step.done) break; const value = step.value; log.push("first:" + value); first.push(value); const close = firstIterator.return; if (close !== undefined) await close.call(firstIterator); break; }
  log.push("between");
  const secondIterator = source[Symbol.asyncIterator]();
  while (true) { const step = await secondIterator.next(); if (step.done) break; const value = step.value; log.push("rest:" + value); rest.push(value); }
  log.push("after"); return [first, rest];
}
async function main(): Promise<void> {
  for (const items of [[2], [5, 7, 9]]) for (const boxed of [false, true]) {
    const cursor = new Source(items), route: Route = boxed ? { kind: "boxed", box: { cursor } } : { kind: "direct", cursor };
    log.length = 0; const seen = await consume(route); log.push("caller");
    const expected = ["consume", "it:iterator", "it:next:0", "first:" + items[0], "between", "it:iterator"];
    for (let index = 1; index < items.length; index++) expected.push("it:next:" + index, "rest:" + items[index]); expected.push("it:next:" + items.length, "after", "caller");
    assert.compareArray(log, expected); assert.compareArray(seen[0], items.slice(0, 1)); assert.compareArray(seen[1], items.slice(1));
    assert.sameValue("return" in cursor, false); assert.sameValue(cursor.closed, 0); assert.sameValue(cursor.index, items.length);
  }
}
main().then(() => $DONE(), (error: unknown) => $DONE(error));
