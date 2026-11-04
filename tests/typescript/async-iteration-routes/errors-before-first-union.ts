/*---
description: "A throw before the first async yield runs generator cleanup before the consumer catches it through a union route; node preserves the exact values, error identity and log."
features: [ts-async-iteration-routes, ts-async-iteration-route-errors, ts-async, ts-async-generators, ts-functions, ts-arrays, ts-errors, ts-numbers, ts-strings, ts-unknown, ts-iteration, ts-instanceof, ts-type-aliases, ts-generics, ts-unions, ts-objects, ts-generators]
flags: [async]
---*/
// A throw before the first async yield runs generator cleanup before the consumer catches it through a union route; node preserves the exact values, error identity and log.
const log: string[] = [];
type Cursor<T> = AsyncIterableIterator<T, void, unknown>;
async function* make<T>(value: T, failure: Error): Cursor<T> {
  try { log.push("start"); throw failure; }
  finally { log.push("finally"); }
}
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
    assert.compareArray(seen, []); assert.sameValue(caught, failure); assert.sameValue(caught instanceof RangeError, true);
    assert.compareArray(log, ["start", "finally", "catch", "consumer:finally", "after"]);
  }
}
run().then(() => $DONE(), (error: unknown) => $DONE(error));
