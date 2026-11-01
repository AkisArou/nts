/*---
description: "Control for finally-continue-before-update; A continue runs finally before the for update and leaves the cleanup value visible there."
features: [ts-control-flow-routes, ts-control-flow-route-finally, ts-functions, ts-arrays, ts-objects, ts-type-aliases, ts-unions, ts-numbers, ts-strings, ts-null-undefined, ts-unknown, ts-typeof-operator, ts-literal-types, ts-iteration]
---*/
// A skip/visit parameter selects loop tails; node writes the union field in finally before every update, including continue edges. The control writes cleanup on each exit path.
type FlowValue = number | string | null | undefined | { id: number };
const first = { id: 7 }, second = { id: 7 };
const inputs: FlowValue[] = [-0, NaN, "", "text", undefined, null, first, second];
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
function inspect(input: FlowValue, mode: "skip" | "visit"): void {
  const log: unknown[] = [], state: { value: FlowValue } = { value: input }; let cleaned = 0;
  for (let index = 0; index < 2; index++, log.push("update", index, state.value)) {
    state.value = input;
    log.push("try", index, state.value);
    if (mode === "skip") {
      log.push("continue", index, state.value); state.value = second; cleaned++; log.push("finally", index, state.value); continue;
    }
    log.push("keep", index, state.value); state.value = second; cleaned++; log.push("finally", index, state.value);
    log.push("tail", index, state.value);
  }
  log.push("loop.exit", cleaned, state.value); same(cleaned, 2); same(state.value, second);
  const expected: unknown[] = [];
  for (let index = 0; index < 2; index++) {
    expected.push("try", index, input, mode === "skip" ? "continue" : "keep", index, input, "finally", index, second);
    if (mode === "visit") expected.push("tail", index, second);
    expected.push("update", index + 1, second);
  }
  expected.push("loop.exit", 2, second); assert.compareArray(log, expected);
}
const modes: ("skip" | "visit")[] = ["skip", "visit"];
for (const input of inputs) for (const mode of modes) inspect(input, mode);
