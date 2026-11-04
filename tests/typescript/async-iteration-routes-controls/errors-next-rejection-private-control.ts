/*---
description: "Control: A custom async iterator rejecting its second next is not closed by the consumer through a private route; node preserves the exact values, error identity and log."
features: [ts-async-iteration-routes, ts-async-iteration-route-errors, ts-async, ts-async-generators, ts-functions, ts-arrays, ts-errors, ts-numbers, ts-strings, ts-unknown, ts-iteration, ts-instanceof, ts-type-aliases, ts-generics, ts-class, ts-class-fields, ts-private-fields, ts-this, ts-symbols]
flags: [async]
---*/
// A custom async iterator rejecting its second next is not closed by the consumer through a private route; node preserves the exact values, error identity and log.
const log: string[] = [];
type Cursor<T> = AsyncIterableIterator<T, void, unknown>;
class Failing<T> implements AsyncIterableIterator<T, void, unknown> {
  value: T; failure: Error; step = 0; constructor(value: T, failure: Error) { this.value = value; this.failure = failure; }
  [Symbol.asyncIterator](): AsyncIterableIterator<T, void, unknown> { log.push("iterator"); return this; }
  async next(): Promise<IteratorResult<T, void>> { log.push("next:" + this.step); if (this.step++ === 0) return { value: this.value, done: false }; throw this.failure; }
  async return(): Promise<IteratorResult<T, void>> { log.push("return"); return { value: undefined, done: true }; }
}
function make<T>(value: T, failure: Error): Cursor<T> { return new Failing(value, failure); }
class Holder<T> { #source: Cursor<T>; constructor(source: Cursor<T>) { this.#source = source; }
  open(): Cursor<T> { return this.#source; } }
async function run(): Promise<void> {
  for (const input of [3, 7]) {
    type Value = number; const variant = input === 3;
    log.length = 0; const failure = new RangeError("source");
    const holder = new Holder(make(input, failure)); const source = holder.open();
    const seen: Value[] = []; let caught: unknown;
    try {
      const iterator = source[Symbol.asyncIterator](); while (true) { const step = await iterator.next(); if (step.done) break; const value = step.value; log.push("body"); seen.push(value); }
    } catch (error: unknown) { caught = error; log.push("catch"); }
    finally { log.push("consumer:finally");  }
    log.push("after");
    assert.compareArray(seen, [input]); assert.sameValue(caught, failure); assert.sameValue(caught instanceof RangeError, true);
    assert.compareArray(log, ["iterator", "next:0", "body", "next:1", "catch", "consumer:finally", "after"]);
  }
}
run().then(() => $DONE(), (error: unknown) => $DONE(error));
