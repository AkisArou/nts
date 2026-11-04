/*---
description: "A private-held generator can yield from finally during hand return; node preserves the awaited pending completion until the following next."
features: [ts-async-iteration-routes, ts-async-iteration-route-protocol, ts-async, ts-functions, ts-function-types, ts-arrays, ts-iteration, ts-numbers, ts-strings, ts-errors, ts-type-aliases, ts-utility-types, ts-unknown, ts-class, ts-class-fields, ts-private-fields, ts-this, ts-async-generators, ts-generators]
flags: [async]
---*/
// A private-held generator can yield from finally during hand return; node preserves the awaited pending completion until the following next.
const log: string[] = [];
type Cursor = Pick<AsyncGenerator<number, number | undefined, unknown>, "next" | "return">;
async function* make(input: number): AsyncGenerator<number, number | undefined, unknown> {
  try { log.push("body"); yield input; log.push("normal"); }
  finally { log.push("finally:yield"); yield input + 1; log.push("finally:resume"); } return undefined;
}
class Holder { #source: Cursor; constructor(input: number) { this.#source = make(input); } open(): Cursor { return this.#source; } }
async function run(): Promise<void> {
  for (const input of [3, 7]) {
    log.length = 0; const source = new Holder(input).open(), first = await source.next(), closing = await source.return(Promise.resolve(input + 9)), end = await source.next(), after = await source.next(); log.push("after");
    assert.compareArray([first.done, closing.done, end.done, after.done], [false, false, true, true]); assert.compareArray([first.value, closing.value, end.value, after.value], [input, input + 1, input + 9, undefined]);
    assert.compareArray(log, ["body", "finally:yield", "finally:resume", "after"]);
  }
}
run().then(() => $DONE(), (error: unknown) => $DONE(error));
