/*---
description: "A hand return before the first next crosses a static route; node finishes without entering the generator body or finally."
features: [ts-async-iteration-routes, ts-async-iteration-route-protocol, ts-async, ts-functions, ts-function-types, ts-arrays, ts-iteration, ts-numbers, ts-strings, ts-errors, ts-type-aliases, ts-utility-types, ts-unknown, ts-class, ts-static, ts-async-generators, ts-generators]
flags: [async]
---*/
// A hand return before the first next crosses a static route; node finishes without entering the generator body or finally.
const log: string[] = [];
type Cursor = Pick<AsyncGenerator<number, number | undefined, unknown>, "next" | "return">;
async function* make(input: number): AsyncGenerator<number, number | undefined, unknown> {
  log.push("body"); try { yield input; } finally { log.push("finally"); } return undefined;
}
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
