/*---
description: "Control: Async yield delegation through a captured let; node keeps the acquired array iterator after the loop body replaces the source binding."
features: [ts-async-iteration-routes, ts-async-iteration-route-delegation, ts-async, ts-functions, ts-iteration, ts-arrays, ts-unknown, ts-closures, ts-readonly, ts-unions, ts-symbols, ts-arrow-functions]
flags: [async]
---*/
// Async yield delegation through a captured let; node keeps the acquired array iterator after the loop body replaces the source binding.
const log: string[] = [];
async function main(): Promise<void> {
  for (const input of [[], [5], [5, 6, 7]]) {
    log.length = 0; const replacement: (number | Promise<number>)[] = [99]; const selected: (number | Promise<number>)[] = [];
    for (const value of input) selected.push(Promise.resolve(value)); let source: readonly (number | Promise<number>)[] = selected;
    const values: number[] = []; let completion: unknown = "unset";
    async function walk(): Promise<void> {
      log.push("outer:start"); const iterator = source[Symbol.iterator]();
      while (true) { const step = iterator.next(); if (step.done) { completion = await step.value; break; }
        const value = await step.value; log.push("body:" + value); values.push(value); source = replacement; log.push("replace"); }
      log.push("outer:completion");
    }
    await walk();
    log.push("after"); const expected = ["outer:start"];
    for (const value of input) expected.push("body:" + value, "replace"); expected.push("outer:completion", "after");
    assert.compareArray(log, expected); assert.compareArray(values, input);
    assert.sameValue(source, input.length ? replacement : selected); assert.sameValue(completion, undefined);
    assert.compareArray(replacement, [99]);
  }
}
main().then(() => $DONE(), (error: unknown) => $DONE(error));
