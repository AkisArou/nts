/*---
description: "Control: For-await over a Map-held Set of mixed values; node throws the rejected element at its step and never delivers the later entry."
features: [ts-async-iteration-routes, ts-async-iteration-route-delegation, ts-async, ts-functions, ts-iteration, ts-arrays, ts-unknown, ts-map-set, ts-unions, ts-narrowing, ts-symbols, ts-errors, ts-instanceof, ts-arrow-functions]
flags: [async]
---*/
// For-await over a Map-held Set of mixed values; node throws the rejected element at its step and never delivers the later entry.
const log: string[] = [];
async function main(): Promise<void> {
  for (const count of [0, 1, 3]) {
    log.length = 0; const reason = new RangeError("value"); const input: number[] = [], set: Set<number | Promise<number>> = new Set();
    for (let index = 0; index < count; index++) { input.push(index + 1); set.add(index % 2 ? index + 1 : Promise.resolve(index + 1)); }
    set.add(Promise.reject(reason)); set.add(99); const sources: Map<string, Set<number | Promise<number>>> = new Map([["selected", set]]);
    const source = sources.get("selected"); if (!source) throw new Error("source"); const values: number[] = []; let caught: unknown = undefined;
    try { const iterator = source[Symbol.iterator](); while (true) { const step = iterator.next(); if (step.done) { await step.value; break; }
      const value = await step.value; log.push("body:" + value); values.push(value); } }
    catch (error: unknown) { caught = error; log.push("catch"); }
    log.push("after"); const expected: string[] = []; for (const value of input) expected.push("body:" + value); expected.push("catch", "after");
    assert.compareArray(log, expected); assert.compareArray(values, input);
    assert.sameValue(caught instanceof RangeError, true); assert.sameValue(caught, reason);
    assert.sameValue(source.size, count + 2); assert.sameValue(source.has(99), true);
  }
}
main().then(() => $DONE(), (error: unknown) => $DONE(error));
