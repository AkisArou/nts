/*---
description: "Control: A throw after one async yield preserves the delivered value and rejects the next step through a field route; node preserves the exact values, error identity and log."
features: [ts-async-iteration-routes, ts-async-iteration-route-errors, ts-async, ts-async-generators, ts-functions, ts-arrays, ts-errors, ts-numbers, ts-strings, ts-unknown, ts-iteration, ts-instanceof, ts-type-aliases, ts-generics, ts-class, ts-class-fields, ts-this, ts-symbols]
flags: [async]
---*/
// A throw after one async yield preserves the delivered value and rejects the next step through a field route; node preserves the exact values, error identity and log.
const log: string[] = [];
type Cursor<T> = AsyncIterableIterator<T, void, unknown>;
class Steps<T> implements AsyncIterableIterator<T, void, unknown> {
  value: T; failure: Error; step = 0; constructor(value: T, failure: Error) { this.value = value; this.failure = failure; }
  [Symbol.asyncIterator](): AsyncIterableIterator<T, void, unknown> { return this; }
  async next(): Promise<IteratorResult<T, void>> {
    if (this.step >= 2) return { value: undefined, done: true };
    if (this.step++ === 0) { log.push("start"); log.push("yield"); return { value: this.value, done: false }; }
    try { log.push("resume"); throw this.failure; } finally { log.push("finally"); }
    return { value: undefined, done: true };
  }
}
function make<T>(value: T, failure: Error): Cursor<T> { return new Steps(value, failure); }
class Holder<T> { source: Cursor<T>; constructor(source: Cursor<T>) { this.source = source; } }
async function run(): Promise<void> {
  for (const input of [3, 7]) {
    type Value = number; const variant = input === 3;
    log.length = 0; const failure = new RangeError("source");
    const holder = new Holder(make(input, failure)); const source = holder.source;
    const seen: Value[] = []; let caught: unknown;
    try {
      const iterator = source[Symbol.asyncIterator](); while (true) { const step = await iterator.next(); if (step.done) break; const value = step.value; log.push("body"); seen.push(value); }
    } catch (error: unknown) { caught = error; log.push("catch"); }
    finally { log.push("consumer:finally");  }
    log.push("after");
    assert.compareArray(seen, [input]); assert.sameValue(caught, failure); assert.sameValue(caught instanceof RangeError, true);
    assert.compareArray(log, ["start", "yield", "body", "resume", "finally", "catch", "consumer:finally", "after"]);
  }
}
run().then(() => $DONE(), (error: unknown) => $DONE(error));
