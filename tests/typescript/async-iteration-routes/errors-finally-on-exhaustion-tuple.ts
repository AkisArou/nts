/*---
description: "A throw in finally during normal async-generator exhaustion rejects the final step through a tuple route; node preserves the exact values, error identity and log."
features: [ts-async-iteration-routes, ts-async-iteration-route-errors, ts-async, ts-async-generators, ts-functions, ts-arrays, ts-errors, ts-numbers, ts-strings, ts-unknown, ts-iteration, ts-instanceof, ts-type-aliases, ts-generics, ts-tuples, ts-generators]
flags: [async]
---*/
// A throw in finally during normal async-generator exhaustion rejects the final step through a tuple route; node preserves the exact values, error identity and log.
const log: string[] = [];
type Cursor<T> = AsyncIterableIterator<T, void, unknown>;
async function* make<T>(value: T, failure: Error): Cursor<T> {
  try { log.push("start"); log.push("yield"); yield value; log.push("resume"); }
  finally { log.push("finally"); throw failure; }
}
async function run(): Promise<void> {
  for (const input of [3, 7]) {
    type Value = number; const variant = input === 3;
    log.length = 0; const failure = new RangeError("source");
    const slot: [string, Cursor<Value>] = ["run", make(input, failure)]; const source = slot[1];
    const seen: Value[] = []; let caught: unknown;
    try {
      for await (const value of source) { log.push("body"); seen.push(value); }
    } catch (error: unknown) { caught = error; log.push("catch"); }
    finally { log.push("consumer:finally");  }
    log.push("after");
    assert.compareArray(seen, [input]); assert.sameValue(caught, failure); assert.sameValue(caught instanceof RangeError, true);
    assert.compareArray(log, ["start", "yield", "body", "resume", "finally", "catch", "consumer:finally", "after"]);
  }
}
run().then(() => $DONE(), (error: unknown) => $DONE(error));
