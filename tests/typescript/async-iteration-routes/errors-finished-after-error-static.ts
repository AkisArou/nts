/*---
description: "An async generator that threw remains completed when a second loop walks it through a static route; node preserves the exact values, error identity and log."
features: [ts-async-iteration-routes, ts-async-iteration-route-errors, ts-async, ts-async-generators, ts-functions, ts-arrays, ts-errors, ts-numbers, ts-strings, ts-unknown, ts-iteration, ts-instanceof, ts-type-aliases, ts-generics, ts-class, ts-static, ts-generators]
flags: [async]
---*/
// An async generator that threw remains completed when a second loop walks it through a static route; node preserves the exact values, error identity and log.
const log: string[] = [];
type Cursor<T> = AsyncIterableIterator<T, void, unknown>;
async function* make<T>(value: T, failure: Error): Cursor<T> {
  try { log.push("start"); log.push("yield"); yield value; log.push("resume"); throw failure; }
  finally { log.push("finally"); }
}
class Holder { static open<T>(value: T, error: Error): Cursor<T> { return make(value, error); } }
async function run(): Promise<void> {
  for (const input of [3, 7]) {
    type Value = number; const variant = input === 3;
    log.length = 0; const failure = new RangeError("source");
    const source = Holder.open(input, failure);
    const seen: Value[] = []; let caught: unknown;
    try {
      for await (const value of source) { log.push("body"); seen.push(value); }
    } catch (error: unknown) { caught = error; log.push("catch"); }
    finally { log.push("consumer:finally");  }
    log.push("after");
    const again: Value[] = []; for await (const value of source) { log.push("second:body"); again.push(value); } log.push("second:after"); assert.compareArray(again, []);
    assert.compareArray(seen, [input]); assert.sameValue(caught, failure); assert.sameValue(caught instanceof RangeError, true);
    assert.compareArray(log, ["start", "yield", "body", "resume", "finally", "catch", "consumer:finally", "after", "second:after"]);
  }
}
run().then(() => $DONE(), (error: unknown) => $DONE(error));
