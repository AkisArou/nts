/*---
description: "A rejected await caught inside the async generator permits later yields and normal completion through a private route; node preserves the exact values, error identity and log."
features: [ts-async-iteration-routes, ts-async-iteration-route-errors, ts-async, ts-async-generators, ts-functions, ts-arrays, ts-errors, ts-numbers, ts-strings, ts-unknown, ts-iteration, ts-instanceof, ts-type-aliases, ts-generics, ts-class, ts-class-fields, ts-private-fields, ts-this, ts-generators]
flags: [async]
---*/
// A rejected await caught inside the async generator permits later yields and normal completion through a private route; node preserves the exact values, error identity and log.
const log: string[] = [];
type Cursor<T> = AsyncIterableIterator<T, void, unknown>;
async function* make<T>(value: T, failure: Error): Cursor<T> {
  try { log.push("start"); try { await Promise.reject(failure); } catch (error: unknown) { log.push(error === failure ? "caught" : "wrong"); }
    log.push("yield"); yield value; log.push("resume"); yield value; log.push("end"); }
  finally { log.push("finally"); }
}
class Holder<T> { #source: Cursor<T>; constructor(source: Cursor<T>) { this.#source = source; }
  open(): Cursor<T> { return this.#source; } }
async function run(): Promise<void> {
  for (const input of [3, 7]) {
    type Value = number; const variant = input === 3;
    log.length = 0; const failure = new RangeError("source");
    const holder = new Holder(make(input, failure)); const source = holder.open();
    const seen: Value[] = []; let caught: unknown;
    try {
      for await (const value of source) { log.push("body"); seen.push(value); }
    } catch (error: unknown) { caught = error; log.push("catch"); }
    finally { log.push("consumer:finally");  }
    log.push("after");
    assert.compareArray(seen, [input, input]); assert.sameValue(caught, undefined);
    assert.compareArray(log, ["start", "caught", "yield", "body", "resume", "body", "end", "finally", "consumer:finally", "after"]);
  }
}
run().then(() => $DONE(), (error: unknown) => $DONE(error));
