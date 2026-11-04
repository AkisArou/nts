/*---
description: "Control: A private-held generator can yield from finally during hand return; node preserves the awaited pending completion until the following next."
features: [ts-async-iteration-routes, ts-async-iteration-route-protocol, ts-async, ts-functions, ts-function-types, ts-arrays, ts-iteration, ts-numbers, ts-strings, ts-errors, ts-type-aliases, ts-utility-types, ts-unknown, ts-class, ts-class-fields, ts-private-fields, ts-this]
flags: [async]
---*/
// A private-held generator can yield from finally during hand return; node preserves the awaited pending completion until the following next.
const log: string[] = [];
type Cursor = Pick<AsyncGenerator<number, number | undefined, unknown>, "next" | "return">;
class Closing {
  input: number; state = 0; completion: number | undefined; constructor(input: number) { this.input = input; }
  async next(): Promise<IteratorResult<number, number | undefined>> {
    if (this.state === 0) { this.state = 1; log.push("body"); return { value: this.input, done: false }; }
    if (this.state === 2) { this.state = 3; log.push("finally:resume"); return { value: this.completion, done: true }; }
    return { value: undefined, done: true };
  }
  async return(value: number | undefined | PromiseLike<number | undefined>): Promise<IteratorResult<number, number | undefined>> { this.completion = await value; this.state = 2; log.push("finally:yield"); return { value: this.input + 1, done: false }; }
}
function make(input: number): Cursor { return new Closing(input); }
class Holder { #source: Cursor; constructor(input: number) { this.#source = make(input); } open(): Cursor { return this.#source; } }
async function run(): Promise<void> {
  for (const input of [3, 7]) {
    log.length = 0; const source = new Holder(input).open(), first = await source.next(), closing = await source.return(Promise.resolve(input + 9)), end = await source.next(), after = await source.next(); log.push("after");
    assert.compareArray([first.done, closing.done, end.done, after.done], [false, false, true, true]); assert.compareArray([first.value, closing.value, end.value, after.value], [input, input + 1, input + 9, undefined]);
    assert.compareArray(log, ["body", "finally:yield", "finally:resume", "after"]);
  }
}
run().then(() => $DONE(), (error: unknown) => $DONE(error));
