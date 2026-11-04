/*---
description: "An async iterator promise value crosses the private route unchanged; node hands the loop the original promise, observed through unknown."
features: [ts-async-iteration-routes, ts-async-iteration-route-protocol, ts-async, ts-async-generators, ts-functions, ts-function-types, ts-arrays, ts-iteration, ts-class, ts-class-fields, ts-this, ts-symbols, ts-generics, ts-numbers, ts-strings, ts-errors, ts-unknown, ts-instanceof, ts-readonly, ts-private-fields]
flags: [async]
---*/
// An async iterator promise value crosses the private route unchanged; node hands the loop the original promise, observed through unknown.
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
class Holder<T> { #source: Values<Promise<T>>; constructor(source: Values<Promise<T>>) { this.#source = source; } open(): Values<Promise<T>> { return this.#source; } }
async function consume<Value>(input: Value): Promise<void> {
  const promise = Promise.resolve(input); const holder = new Holder(new Values([promise])); const source = holder.open();
  log.length = 0; const seen: unknown[] = [];
  for await (const value of source) { const received: unknown = value; log.push("body"); assert.sameValue(received instanceof Promise, true); assert.sameValue(received, promise); seen.push(await received); log.push("value:awaited"); }
  log.push("after"); assert.compareArray(seen, [input]);
  assert.compareArray(log, ["iterator", "next:0", "ready:0", "body", "value:awaited", "next:1", "ready:1", "after"]);
}
async function run(): Promise<void> { await consume<number>(3); await consume<string>("three"); }
run().then(() => $DONE(), (error: unknown) => $DONE(error));
