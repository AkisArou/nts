/*---
description: "Control: A throw before the first async yield runs generator cleanup before the consumer catches it through a union route; node preserves the exact values, error identity and log."
features: [ts-async-iteration-routes, ts-async-iteration-route-errors, ts-async, ts-async-generators, ts-functions, ts-arrays, ts-errors, ts-numbers, ts-strings, ts-unknown, ts-iteration, ts-instanceof, ts-type-aliases, ts-generics, ts-unions, ts-objects, ts-class, ts-class-fields, ts-this, ts-symbols]
flags: [async]
---*/
// A throw before the first async yield runs generator cleanup before the consumer catches it through a union route; node preserves the exact values, error identity and log.
const log: string[] = [];
type Cursor<T> = AsyncIterableIterator<T, void, unknown>;
class Steps<T> implements AsyncIterableIterator<T, void, unknown> {
  value: T; failure: Error; step = 0; constructor(value: T, failure: Error) { this.value = value; this.failure = failure; }
  [Symbol.asyncIterator](): AsyncIterableIterator<T, void, unknown> { return this; }
  async next(): Promise<IteratorResult<T, void>> {
    if (this.step >= 2) return { value: undefined, done: true };
    this.step = 2; try { log.push("start"); throw this.failure; } finally { log.push("finally"); }
  }
}
function make<T>(value: T, failure: Error): Cursor<T> { return new Steps(value, failure); }
type Choice<T> = { kind: "direct"; value: Cursor<T> } | { kind: "boxed"; box: { value: Cursor<T> } };
async function run(): Promise<void> {
  for (const input of [3, 7]) {
    type Value = number; const variant = input === 3;
    log.length = 0; const failure = new RangeError("source");
    const choice: Choice<Value> = variant ? { kind: "direct", value: make(input, failure) } : { kind: "boxed", box: { value: make(input, failure) } };
    const source = choice.kind === "direct" ? choice.value : choice.box.value;
    const seen: Value[] = []; let caught: unknown;
    try {
      const iterator = source[Symbol.asyncIterator](); while (true) { const step = await iterator.next(); if (step.done) break; const value = step.value; log.push("body"); seen.push(value); }
    } catch (error: unknown) { caught = error; log.push("catch"); }
    finally { log.push("consumer:finally");  }
    log.push("after");
    assert.compareArray(seen, []); assert.sameValue(caught, failure); assert.sameValue(caught instanceof RangeError, true);
    assert.compareArray(log, ["start", "finally", "catch", "consumer:finally", "after"]);
  }
}
run().then(() => $DONE(), (error: unknown) => $DONE(error));
