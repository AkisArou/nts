/*---
description: "A generic async consumer returns normally when its iterator has no return method."
features: [ts-async-iteration-routes, ts-async-iteration-route-exits, ts-async, ts-async-generators, ts-iteration, ts-functions, ts-arrays, ts-numbers, ts-strings, ts-unknown, ts-class, ts-class-fields, ts-this, ts-symbols, ts-readonly, ts-generics, ts-null-undefined, ts-unions, ts-errors, ts-objects, ts-generic-constraints, ts-typeof-operator]
flags: [async]
---*/
// A generic consumer is instantiated with numbers and strings; node preserves its first returned value while leaving an iterator with no return method untouched.
const log: string[] = [];
class Source<T> implements AsyncIterableIterator<T, undefined, unknown> {
  items: readonly T[]; name: string; index: number = 0; closed: number = 0; fault: Error | undefined;
  constructor(items: readonly T[], name: string = "it", fault?: Error) { log.push("new:" + name); this.items = items; this.name = name; this.fault = fault; }
  [Symbol.asyncIterator](): AsyncIterableIterator<T, undefined, unknown> { log.push(this.name + ":iterator"); return this; }
  async next(): Promise<IteratorResult<T, undefined>> { log.push(this.name + ":next:" + this.index); return this.closed || this.index === this.items.length ? { done: true, value: undefined } : { done: false, value: this.items[this.index++] }; }
}
async function consume<T extends number | string>(source: AsyncIterable<T>): Promise<T | undefined> { log.push("consume");
  for await (const value of source) { log.push("body:" + String(value)); return value; }
  log.push("empty"); return undefined;
}
async function check<T extends number | string>(items: readonly T[], kind: string): Promise<void> {
  const cursor = new Source(items); log.length = 0; const value = await consume<T>(cursor); log.push("caller");
  const expected = ["consume", "it:iterator", "it:next:0", items.length > 0 ? "body:" + String(items[0]) : "empty", "caller"];
  assert.compareArray(log, expected); assert.sameValue(value, items[0]); assert.sameValue(typeof value, items.length > 0 ? kind : "undefined");
  assert.sameValue("return" in cursor, false); assert.sameValue(cursor.closed, 0); assert.sameValue(cursor.index, items.length > 0 ? 1 : 0);
}
async function main(): Promise<void> { await check<number>([], "number"); await check<number>([2, 3], "number"); await check<string>([], "string"); await check<string>(["a", "b"], "string"); }
main().then(() => $DONE(), (error: unknown) => $DONE(error));
