/*---
description: "A finally break suppresses a union throw and reaches the post-loop return without a catch."
features: [ts-control-flow-routes, ts-control-flow-route-finally, ts-functions, ts-arrays, ts-objects, ts-type-aliases, ts-unions, ts-numbers, ts-strings, ts-null-undefined, ts-unknown, ts-typeof-operator, ts-literal-types, ts-iteration, ts-closures, ts-errors]
---*/
// A break/throw parameter selects suppression of primitive or identity-bearing throws; node takes the break or catches the original payload after cleanup.
type FlowValue = number | string | null | undefined | { id: number };
const first = { id: 7 }, second = { id: 7 };
const inputs: FlowValue[] = [-0, NaN, "", "text", undefined, null, first, second];
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
function inspect(input: FlowValue, mode: "break" | "throw"): void {
  const log: unknown[] = [], state: { value: FlowValue } = { value: input }; let result: FlowValue, caught: unknown = second, didCatch = false;
  function run(): FlowValue {
    for (let index = 0; index < 2; index++) {
      try { log.push("throw", index, input); throw input; }
      finally {
        state.value = second; log.push("finally", index, state.value);
        if (mode === "break") { log.push("replace.break", index, state.value); break; }
        log.push("preserve.throw", index, input);
      }
    }
    log.push("loop.exit", state.value); return state.value;
  }
  try { result = run(); log.push("result", result); }
  catch (error: unknown) { caught = error; didCatch = true; log.push("catch", error); }
  log.push("after", state.value, didCatch); same(result, mode === "break" ? second : undefined); same(state.value, second); same(didCatch, mode === "throw"); same(caught, mode === "throw" ? input : second);
  assert.compareArray(log, mode === "break"
    ? ["throw", 0, input, "finally", 0, second, "replace.break", 0, second, "loop.exit", second, "result", second, "after", second, false]
    : ["throw", 0, input, "finally", 0, second, "preserve.throw", 0, input, "catch", input, "after", second, true]);
}
const modes: ("break" | "throw")[] = ["break", "throw"];
for (const input of inputs) for (const mode of modes) inspect(input, mode);
