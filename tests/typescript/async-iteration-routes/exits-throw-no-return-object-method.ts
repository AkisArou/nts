/*---
description: "An object-method async consumer preserves its body error when return is absent."
features: [ts-async-iteration-routes, ts-async-iteration-route-exits, ts-async, ts-async-generators, ts-iteration, ts-functions, ts-arrays, ts-numbers, ts-strings, ts-unknown, ts-class, ts-class-fields, ts-this, ts-symbols, ts-readonly, ts-generics, ts-null-undefined, ts-unions, ts-errors, ts-objects, ts-type-aliases, ts-instanceof]
flags: [async]
---*/
// A declared object method consumes an iterator without return; node leaves the cursor after one value and passes the original URIError to the outside catch.
const log: string[] = [];
class Source<T> implements AsyncIterableIterator<T, undefined, unknown> {
  items: readonly T[]; name: string; index: number = 0; closed: number = 0; fault: Error | undefined;
  constructor(items: readonly T[], name: string = "it", fault?: Error) { log.push("new:" + name); this.items = items; this.name = name; this.fault = fault; }
  [Symbol.asyncIterator](): AsyncIterableIterator<T, undefined, unknown> { log.push(this.name + ":iterator"); return this; }
  async next(): Promise<IteratorResult<T, undefined>> { log.push(this.name + ":next:" + this.index); return this.closed || this.index === this.items.length ? { done: true, value: undefined } : { done: false, value: this.items[this.index++] }; }
}
type Consumer = { run(source: AsyncIterable<number>, failure: Error): Promise<void> };
const consumer: Consumer = { async run(source: AsyncIterable<number>, failure: Error): Promise<void> { log.push("consume");
  for await (const value of source) { log.push("body:" + value); throw failure; }
  log.push("after-loop");
} };
async function main(): Promise<void> {
  for (const items of [[2], [5, 7, 9]]) {
    const cursor = new Source(items), failure = new URIError("body"); let caught: unknown; log.length = 0;
    try { await consumer.run(cursor, failure); } catch (error: unknown) { caught = error; log.push("caught"); } log.push("caller");
    assert.compareArray(log, ["consume", "it:iterator", "it:next:0", "body:" + items[0], "caught", "caller"]);
    assert.sameValue(caught, failure); assert.sameValue(caught instanceof URIError, true); assert.sameValue("return" in cursor, false); assert.sameValue(cursor.closed, 0); assert.sameValue(cursor.index, 1);
  }
}
main().then(() => $DONE(), (error: unknown) => $DONE(error));
