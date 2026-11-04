/*---
description: "A rejected close replaces an enclosing return through a static source field."
features: [ts-async-iteration-routes, ts-async-iteration-route-exits, ts-async, ts-async-generators, ts-iteration, ts-functions, ts-arrays, ts-numbers, ts-strings, ts-unknown, ts-class, ts-class-fields, ts-this, ts-symbols, ts-readonly, ts-generics, ts-null-undefined, ts-unions, ts-errors, ts-objects, ts-static, ts-instanceof]
flags: [async]
---*/
// A static field carries the iterable; node waits for its close rejection and rejects the consumer instead of delivering the selected number.
const log: string[] = [];
class Source<T> implements AsyncIterableIterator<T, undefined, unknown> {
  items: readonly T[]; name: string; index: number = 0; closed: number = 0; fault: Error | undefined;
  constructor(items: readonly T[], name: string = "it", fault?: Error) { log.push("new:" + name); this.items = items; this.name = name; this.fault = fault; }
  [Symbol.asyncIterator](): AsyncIterableIterator<T, undefined, unknown> { log.push(this.name + ":iterator"); return this; }
  async next(): Promise<IteratorResult<T, undefined>> { log.push(this.name + ":next:" + this.index); return this.closed || this.index === this.items.length ? { done: true, value: undefined } : { done: false, value: this.items[this.index++] }; }
  async return(): Promise<IteratorResult<T, undefined>> { log.push(this.name + ":return:start"); this.closed++; await Promise.resolve(); if (this.fault !== undefined) { log.push(this.name + ":return:reject"); throw this.fault; } log.push(this.name + ":return:end"); return { done: true, value: undefined }; }
}
class Consumer {
  static source: AsyncIterable<number> = new Source<number>([]);
  static async take(): Promise<number | undefined> { log.push("consume"); const source = this.source;
    for await (const value of source) { log.push("body:" + value); return value; }
    log.push("empty"); return undefined;
  }
}
async function main(): Promise<void> {
  for (const items of [[2], [5, 7, 9]]) {
    const failure = new SyntaxError("close"), cursor = new Source(items, "it", failure), result: { value: number | undefined } = { value: undefined }; let caught: unknown;
    Consumer.source = cursor; log.length = 0; try { result.value = await Consumer.take(); } catch (error: unknown) { caught = error; log.push("caught"); } log.push("caller");
    assert.compareArray(log, ["consume", "it:iterator", "it:next:0", "body:" + items[0], "it:return:start", "it:return:reject", "caught", "caller"]);
    assert.sameValue(result.value, undefined); assert.sameValue(caught, failure); assert.sameValue(caught instanceof SyntaxError, true); assert.sameValue(cursor.closed, 1); assert.sameValue(cursor.index, 1);
    assert.sameValue(Consumer.source, cursor);
  }
}
main().then(() => $DONE(), (error: unknown) => $DONE(error));
