/*---
description: "Control: A hand rejected-return before the first next crosses a tuple route; node finishes without entering the generator body or finally."
features: [ts-async-iteration-routes, ts-async-iteration-route-protocol, ts-async, ts-functions, ts-function-types, ts-arrays, ts-iteration, ts-numbers, ts-strings, ts-errors, ts-type-aliases, ts-utility-types, ts-unknown, ts-tuples, ts-instanceof, ts-class, ts-class-fields, ts-this]
flags: [async]
---*/
// A hand rejected-return before the first next crosses a tuple route; node finishes without entering the generator body or finally.
const log: string[] = [];
type Cursor = Pick<AsyncGenerator<number, number | undefined, unknown>, "next" | "return">;
class Dormant {
  input: number; done = false; constructor(input: number) { this.input = input; }
  async next(): Promise<IteratorResult<number, number | undefined>> { if (this.done) return { value: undefined, done: true }; this.done = true; log.push("body"); return { value: this.input, done: false }; }
  async return(value: number | undefined | PromiseLike<number | undefined>): Promise<IteratorResult<number, number | undefined>> { this.done = true; return { value: await value, done: true }; }
  throw(error: unknown): Promise<IteratorResult<number, number | undefined>> { this.done = true; return Promise.reject(error); }
}
function make(input: number): Cursor { return new Dormant(input); }

async function run(): Promise<void> {
  for (const input of [3, 7]) {
    log.length = 0; const tuple: [Cursor] = [make(input)]; const source = tuple[0];
    const failure = new URIError("stop"); let caught: unknown; try { await source.return(Promise.reject(failure)); } catch (error: unknown) { caught = error; log.push("catch"); }
    assert.sameValue(caught, failure); assert.sameValue(caught instanceof URIError, true);
    const after = await source.next(); log.push("after"); assert.sameValue(after.done, true); assert.sameValue(after.value, undefined);
    assert.compareArray(log, ["catch", "after"]);
  }
}
run().then(() => $DONE(), (error: unknown) => $DONE(error));
