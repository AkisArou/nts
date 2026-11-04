/*---
description: "Control: A rejected value from a tuple-held sync generator; node closes the generator, runs finally once and preserves the rejection class before continuing."
features: [ts-async-iteration-routes, ts-async-iteration-route-delegation, ts-async, ts-functions, ts-iteration, ts-arrays, ts-unknown, ts-generators, ts-tuples, ts-objects, ts-unions, ts-errors, ts-instanceof, ts-arrow-functions]
flags: [async]
---*/
// A rejected value from a tuple-held sync generator; node closes the generator, runs finally once and preserves the rejection class before continuing.
const log: string[] = [];
function* make(count: number, reason: Error, state: { closed: number }): Generator<number | Promise<number>, void, void> {
  try {
    for (let index = 0; index < count; index++) { log.push("yield:" + index); yield index % 2 ? index + 1 : Promise.resolve(index + 1); }
    log.push("reject"); yield Promise.reject(reason); log.push("unreachable");
  } finally { state.closed++; log.push("finally"); }
}
async function main(): Promise<void> {
  for (const count of [0, 1, 3]) for (const Constructor of [RangeError, TypeError]) {
    log.length = 0; const reason = new Constructor("value"), state = { closed: 0 };
    const route: [string, Generator<number | Promise<number>, void, void>] = ["selected", make(count, reason, state)];
    const values: number[] = []; let caught: unknown = undefined;
    try { const iterator = route[1]; while (true) {
      const step = iterator.next(); if (step.done) { await step.value; break; } let value: number;
      try { value = await step.value; } catch (error: unknown) { iterator.return(undefined); throw error; }
      log.push("body:" + value); values.push(value);
    } }
    catch (error: unknown) { caught = error; log.push("catch"); }
    log.push("after"); const again = route[1].next(); const expected: string[] = [], wanted: number[] = [];
    for (let index = 0; index < count; index++) { wanted.push(index + 1); expected.push("yield:" + index, "body:" + (index + 1)); }
    expected.push("reject", "finally", "catch", "after");
    assert.compareArray(log, expected); assert.compareArray(values, wanted);
    assert.sameValue(caught instanceof Constructor, true); assert.sameValue(caught, reason); assert.sameValue(state.closed, 1);
    assert.sameValue(again.done, true); assert.sameValue(again.value, undefined); assert.sameValue(route[0], "selected");
  }
}
main().then(() => $DONE(), (error: unknown) => $DONE(error));
