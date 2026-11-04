/*---
description: "Async yield delegation through a readonly array tuple element; node awaits mixed elements and exposes the array completion as undefined."
features: [ts-async-iteration-routes, ts-async-iteration-route-delegation, ts-async, ts-functions, ts-iteration, ts-arrays, ts-unknown, ts-async-generators, ts-generators, ts-tuples, ts-readonly, ts-unions, ts-typeof-operator, ts-type-aliases, ts-arrow-functions]
flags: [async]
---*/
// Async yield delegation through a readonly array tuple element; node awaits mixed elements and exposes the array completion as undefined.
const log: string[] = [];
type Source = readonly (number | Promise<number>)[];
async function main(): Promise<void> {
  for (const input of [[], [-0], [1, NaN, 3]]) {
    log.length = 0; const items: (number | Promise<number>)[] = [];
    for (let index = 0; index < input.length; index++) items.push(index % 2 ? input[index] : Promise.resolve(input[index]));
    const route: [string, Source] = ["array", items]; const values: number[] = []; let completion: unknown = "unset";
    async function* outer(): AsyncIterableIterator<number, void, void> {
      log.push("outer:start"); completion = yield* route[1]; log.push("outer:completion");
    }
    for await (const value of outer()) { log.push("body:" + value); values.push(value); }
    log.push("after"); const expected = ["outer:start"];
    for (const value of input) expected.push("body:" + value); expected.push("outer:completion", "after");
    assert.compareArray(log, expected); assert.compareArray(values, input);
    assert.sameValue(completion, undefined); assert.sameValue(route[1], items); assert.sameValue(route[0], "array");
    for (const value of values) assert.sameValue(typeof value, "number");
  }
}
main().then(() => $DONE(), (error: unknown) => $DONE(error));
