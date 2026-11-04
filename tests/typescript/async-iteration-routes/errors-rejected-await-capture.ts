/*---
description: "An uncaught rejected await resumes generator cleanup before rejecting the consumer step through a capture route; node preserves the exact values, error identity and log."
features: [ts-async-iteration-routes, ts-async-iteration-route-errors, ts-async, ts-async-generators, ts-functions, ts-arrays, ts-errors, ts-numbers, ts-strings, ts-unknown, ts-iteration, ts-instanceof, ts-type-aliases, ts-generics, ts-closures, ts-arrow-functions, ts-function-types, ts-generators]
flags: [async]
---*/
// An uncaught rejected await resumes generator cleanup before rejecting the consumer step through a capture route; node preserves the exact values, error identity and log.
const log: string[] = [];
type Cursor<T> = AsyncIterableIterator<T, void, unknown>;
async function* make<T>(value: T, failure: Error): Cursor<T> {
  try { log.push("start"); log.push("yield"); yield value; log.push("resume"); log.push("await"); await Promise.reject(failure); }
  finally { log.push("finally"); }
}
async function run(): Promise<void> {
  for (const input of [3, 7]) {
    type Value = number; const variant = input === 3;
    log.length = 0; const failure = new RangeError("source");
    let current: Cursor<Value> = make(input, failure);
    const seen: Value[] = []; let caught: unknown;
    try {
      const walk = async (): Promise<void> => { for await (const value of current) { log.push("body"); seen.push(value); } }; current = make(input, failure); await walk();
    } catch (error: unknown) { caught = error; log.push("catch"); }
    finally { log.push("consumer:finally");  }
    log.push("after");
    assert.compareArray(seen, [input]); assert.sameValue(caught, failure); assert.sameValue(caught instanceof RangeError, true);
    assert.compareArray(log, ["start", "yield", "body", "resume", "await", "finally", "catch", "consumer:finally", "after"]);
  }
}
run().then(() => $DONE(), (error: unknown) => $DONE(error));
