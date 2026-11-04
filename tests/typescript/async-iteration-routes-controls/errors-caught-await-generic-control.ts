/*---
description: "Control: A rejected await caught inside the async generator permits later yields and normal completion through a generic route; node preserves the exact values, error identity and log."
features: [ts-async-iteration-routes, ts-async-iteration-route-errors, ts-async, ts-async-generators, ts-functions, ts-arrays, ts-errors, ts-numbers, ts-strings, ts-unknown, ts-iteration, ts-instanceof, ts-type-aliases, ts-generics, ts-class, ts-class-fields, ts-this, ts-symbols]
flags: [async]
---*/
// A rejected await caught inside the async generator permits later yields and normal completion through a generic route; node preserves the exact values, error identity and log.
const log: string[] = [];
type Cursor<T> = AsyncIterableIterator<T, void, unknown>;
class Steps<T> implements AsyncIterableIterator<T, void, unknown> {
  value: T; failure: Error; step = 0; constructor(value: T, failure: Error) { this.value = value; this.failure = failure; }
  [Symbol.asyncIterator](): AsyncIterableIterator<T, void, unknown> { return this; }
  async next(): Promise<IteratorResult<T, void>> {
    if (this.step >= 3) return { value: undefined, done: true };
    if (this.step++ === 0) { log.push("start"); try { await Promise.reject(this.failure); } catch (error: unknown) { log.push(error === this.failure ? "caught" : "wrong"); }
      log.push("yield"); return { value: this.value, done: false }; }
    if (this.step === 2) { log.push("resume"); return { value: this.value, done: false }; }
    log.push("end"); log.push("finally"); return { value: undefined, done: true };
  }
}
function make<T>(value: T, failure: Error): Cursor<T> { return new Steps(value, failure); }
function carry<T>(source: Cursor<T>): Cursor<T> { return source; }
async function trial<Value>(input: Value, variant: boolean): Promise<void> {
  log.length = 0; const failure = new RangeError("source");
  const source = carry<Value>(make(input, failure));
  const seen: Value[] = []; let caught: unknown;
  try {
    const iterator = source[Symbol.asyncIterator](); while (true) { const step = await iterator.next(); if (step.done) break; const value = step.value; log.push("body"); seen.push(value); }
  } catch (error: unknown) { caught = error; log.push("catch"); }
  finally { log.push("consumer:finally");  }
  log.push("after");
  assert.compareArray(seen, [input, input]); assert.sameValue(caught, undefined);
  assert.compareArray(log, ["start", "caught", "yield", "body", "resume", "body", "end", "finally", "consumer:finally", "after"]);
}
async function run(): Promise<void> { await trial<number>(3, true); await trial<string>("three", false); }
run().then(() => $DONE(), (error: unknown) => $DONE(error));
