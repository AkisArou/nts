/*---
description: "A return snapshots a union field before finally overwrites it, while normal completion reads the overwritten field."
features: [ts-control-flow-routes, ts-control-flow-route-finally, ts-functions, ts-arrays, ts-objects, ts-type-aliases, ts-unions, ts-numbers, ts-strings, ts-null-undefined, ts-unknown, ts-typeof-operator, ts-literal-types, ts-iteration, ts-closures, ts-errors]
---*/
// A return/fall parameter chooses the exit from try; node logs cleanup once, returns the saved union value on return and exposes the final field afterwards.
type FlowValue = number | string | null | undefined | { id: number };
const first = { id: 7 }, second = { id: 7 };
const inputs: FlowValue[] = [-0, NaN, "", "text", undefined, null, first, second];
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
function inspect(input: FlowValue, mode: "return" | "fall"): void {
  const log: unknown[] = [], state: { value: FlowValue } = { value: input };
  function run(): FlowValue {
    try {
      log.push("try", state.value);
      if (mode === "return") { log.push("return", state.value); return state.value; }
      log.push("fall", state.value);
    } finally { state.value = second; log.push("finally", state.value); }
    log.push("after", state.value); return state.value;
  }
  const result = run(); log.push("result", result, state.value);
  same(result, mode === "return" ? input : second); same(state.value, second);
  assert.compareArray(log, mode === "return"
    ? ["try", input, "return", input, "finally", second, "result", input, second]
    : ["try", input, "fall", input, "finally", second, "after", second, "result", second, second]);
}
const modes: ("return" | "fall")[] = ["return", "fall"];
for (const input of inputs) for (const mode of modes) inspect(input, mode);
