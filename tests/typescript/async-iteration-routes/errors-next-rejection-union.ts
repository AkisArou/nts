/*---
description: "A custom async iterator rejecting its second next is not closed by the consumer through a union route; node preserves the exact values, error identity and log."
features: [ts-async-iteration-routes, ts-async-iteration-route-errors, ts-async, ts-async-generators, ts-functions, ts-arrays, ts-errors, ts-numbers, ts-strings, ts-unknown, ts-iteration, ts-instanceof, ts-type-aliases, ts-generics, ts-unions, ts-objects, ts-class, ts-class-fields, ts-this, ts-symbols]
flags: [async]
---*/
// A custom async iterator rejecting its second next is not closed by the consumer through a union route; node preserves the exact values, error identity and log.
const log: string[] = [];
type Cursor<T> = AsyncIterableIterator<T, void, unknown>;
class Failing<T> implements AsyncIterableIterator<T, void, unknown> {
  value: T; failure: Error; step = 0; constructor(value: T, failure: Error) { this.value = value; this.failure = failure; }
  [Symbol.asyncIterator](): AsyncIterableIterator<T, void, unknown> { log.push("iterator"); return this; }
  async next(): Promise<IteratorResult<T, void>> { log.push("next:" + this.step); if (this.step++ === 0) return { value: this.value, done: false }; throw this.failure; }
  async return(): Promise<IteratorResult<T, void>> { log.push("return"); return { value: undefined, done: true }; }
}
function make<T>(value: T, failure: Error): Cursor<T> { return new Failing(value, failure); }
type Choice<T> = { kind: "direct"; value: Cursor<T> } | { kind: "boxed"; box: { value: Cursor<T> } };
async function run(): Promise<void> {
  for (const input of [3, 7]) {
    type Value = number; const variant = input === 3;
    log.length = 0; const failure = new RangeError("source");
    const choice: Choice<Value> = variant ? { kind: "direct", value: make(input, failure) } : { kind: "boxed", box: { value: make(input, failure) } };
    const source = choice.kind === "direct" ? choice.value : choice.box.value;
    const seen: Value[] = []; let caught: unknown;
    try {
      for await (const value of source) { log.push("body"); seen.push(value); }
    } catch (error: unknown) { caught = error; log.push("catch"); }
    finally { log.push("consumer:finally");  }
    log.push("after");
    assert.compareArray(seen, [input]); assert.sameValue(caught, failure); assert.sameValue(caught instanceof RangeError, true);
    assert.compareArray(log, ["iterator", "next:0", "body", "next:1", "catch", "consumer:finally", "after"]);
  }
}
run().then(() => $DONE(), (error: unknown) => $DONE(error));
