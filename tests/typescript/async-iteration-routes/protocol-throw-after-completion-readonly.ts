/*---
description: "A completed generator in a readonly source array rejects hand throw and remains finished; node next returns undefined and return retains its supplied value."
features: [ts-async-iteration-routes, ts-async-iteration-route-protocol, ts-async, ts-functions, ts-function-types, ts-arrays, ts-iteration, ts-numbers, ts-strings, ts-errors, ts-type-aliases, ts-utility-types, ts-unknown, ts-readonly, ts-instanceof, ts-async-generators, ts-generators]
flags: [async]
---*/
// A completed generator in a readonly source array rejects hand throw and remains finished; node next returns undefined and return retains its supplied value.
const log: string[] = [];
type Cursor = Pick<AsyncGenerator<number, number | undefined, unknown>, "next" | "throw" | "return">;
async function* make(input: number): AsyncGenerator<number, number | undefined, unknown> { log.push("start"); return input; }
async function run(): Promise<void> {
  for (const input of [3, 7]) {
    log.length = 0; const sources: readonly Cursor[] = [make(input)], source = sources[0], end = await source.next(), failure = new RangeError("finished"); let caught: unknown;
    try { await source.throw(failure); } catch (error: unknown) { caught = error; log.push("catch"); }
    const after = await source.next(), returned = await source.return(Promise.resolve(input + 1)); log.push("after");
    assert.sameValue(caught, failure); assert.sameValue(caught instanceof RangeError, true);
    assert.compareArray([end.done, after.done, returned.done], [true, true, true]); assert.compareArray([end.value, after.value, returned.value], [input, undefined, input + 1]);
    assert.compareArray(log, ["start", "catch", "after"]);
  }
}
run().then(() => $DONE(), (error: unknown) => $DONE(error));
