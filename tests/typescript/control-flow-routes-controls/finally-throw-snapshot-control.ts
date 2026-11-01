/*---
description: "Control for finally-throw-snapshot; A thrown union field keeps its evaluated value while finally overwrites the field before catch."
features: [ts-control-flow-routes, ts-control-flow-route-finally, ts-functions, ts-arrays, ts-objects, ts-type-aliases, ts-unions, ts-numbers, ts-strings, ts-null-undefined, ts-unknown, ts-typeof-operator, ts-literal-types, ts-iteration, ts-errors]
---*/
// A throw/normal parameter selects the exit, including undefined and object throws; node catches the pre-cleanup value and reads the post-cleanup field. The control writes cleanup on each exit path.
type FlowValue = number | string | null | undefined | { id: number };
const first = { id: 7 }, second = { id: 7 };
const inputs: FlowValue[] = [-0, NaN, "", "text", undefined, null, first, second];
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
function inspect(input: FlowValue, mode: "throw" | "normal"): void {
  const log: unknown[] = [], state: { value: FlowValue } = { value: input }; let caught: unknown = second, didCatch = false;
  try {
    log.push("try", state.value);
    if (mode === "throw") {
      log.push("throw", state.value); const pending = state.value;
      state.value = second; log.push("finally", state.value); throw pending;
    }
    log.push("normal", state.value); state.value = second; log.push("finally", state.value);
    log.push("after.try", state.value);
  } catch (error: unknown) { caught = error; didCatch = true; log.push("catch", error, state.value); }
  log.push("after", state.value, didCatch); same(state.value, second); same(didCatch, mode === "throw"); same(caught, mode === "throw" ? input : second);
  assert.compareArray(log, mode === "throw"
    ? ["try", input, "throw", input, "finally", second, "catch", input, second, "after", second, true]
    : ["try", input, "normal", input, "finally", second, "after.try", second, "after", second, false]);
}
const modes: ("throw" | "normal")[] = ["throw", "normal"];
for (const input of inputs) for (const mode of modes) inspect(input, mode);
