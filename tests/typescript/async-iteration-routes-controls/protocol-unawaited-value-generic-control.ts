/*---
description: "Control: An async iterator promise value crosses the generic route unchanged; node hands the loop the original promise, observed through unknown."
features: [ts-async-iteration-routes, ts-async-iteration-route-protocol, ts-async, ts-async-generators, ts-functions, ts-function-types, ts-arrays, ts-iteration, ts-class, ts-class-fields, ts-this, ts-symbols, ts-generics, ts-numbers, ts-strings, ts-errors, ts-unknown, ts-instanceof, ts-readonly]
flags: [async]
---*/
// An async iterator promise value crosses the generic route unchanged; node hands the loop the original promise, observed through unknown.
const log: string[] = [];
class Values<T> implements AsyncIterable<T> {
  items: readonly T[]; opens = 0; steps = 0; returns = 0;
  constructor(items: readonly T[]) { this.items = items; }
  [Symbol.asyncIterator](): AsyncIterator<T, void, unknown> {
    log.push("iterator"); this.opens++; const owner = this; let index = 0;
    return { async next(): Promise<IteratorResult<T, void>> {
      log.push("next:" + index); owner.steps++; await Promise.resolve(); log.push("ready:" + index);
      return index < owner.items.length ? { value: owner.items[index++], done: false } : { value: undefined, done: true };
    }, async return(): Promise<IteratorResult<T, void>> { log.push("return"); owner.returns++; return { value: undefined, done: true }; } };
  }
}
async function consume<Value>(input: Value): Promise<void> {
  const promise = Promise.resolve(input); const source: AsyncIterable<Promise<Value>> = new Values([promise]);
  log.length = 0; const seen: unknown[] = [];
  const iterator = source[Symbol.asyncIterator](), next = iterator.next; while (true) { const step = await next.call(iterator); if (step.done) break; const value = step.value; const received: unknown = value; log.push("body"); assert.sameValue(received instanceof Promise, true); assert.sameValue(received, promise); seen.push(await received); log.push("value:awaited"); }
  log.push("after"); assert.compareArray(seen, [input]);
  assert.compareArray(log, ["iterator", "next:0", "ready:0", "body", "value:awaited", "next:1", "ready:1", "after"]);
}
async function run(): Promise<void> { await consume<number>(3); await consume<string>("three"); }
run().then(() => $DONE(), (error: unknown) => $DONE(error));
