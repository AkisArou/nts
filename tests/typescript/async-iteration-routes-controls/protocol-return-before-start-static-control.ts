/*---
description: "Control: A hand return before the first next crosses a static route; node finishes without entering the generator body or finally."
features: [ts-async-iteration-routes, ts-async-iteration-route-protocol, ts-async, ts-functions, ts-function-types, ts-arrays, ts-iteration, ts-numbers, ts-strings, ts-errors, ts-type-aliases, ts-utility-types, ts-unknown, ts-class, ts-static, ts-class-fields, ts-this]
flags: [async]
---*/
// A hand return before the first next crosses a static route; node finishes without entering the generator body or finally.
const log: string[] = [];
type Cursor = Pick<AsyncGenerator<number, number | undefined, unknown>, "next" | "return">;
class Dormant {
  input: number; done = false; constructor(input: number) { this.input = input; }
  async next(): Promise<IteratorResult<number, number | undefined>> { if (this.done) return { value: undefined, done: true }; this.done = true; log.push("body"); return { value: this.input, done: false }; }
  async return(value: number | undefined | PromiseLike<number | undefined>): Promise<IteratorResult<number, number | undefined>> { this.done = true; return { value: await value, done: true }; }
  throw(error: unknown): Promise<IteratorResult<number, number | undefined>> { this.done = true; return Promise.reject(error); }
}
function make(input: number): Cursor { return new Dormant(input); }
class Holder { static open(input: number): Cursor { return make(input); } }
async function run(): Promise<void> {
  for (const input of [3, 7]) {
    log.length = 0; const source = Holder.open(input);
    const value = input === 3 ? input + 10 : Promise.resolve(input + 10); const closed = await source.return(value);
    assert.sameValue(closed.done, true); assert.sameValue(closed.value, input + 10);
    const after = await source.next(); log.push("after"); assert.sameValue(after.done, true); assert.sameValue(after.value, undefined);
    assert.compareArray(log, ["after"]);
  }
}
run().then(() => $DONE(), (error: unknown) => $DONE(error));
