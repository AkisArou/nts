/*---
description: "A finally return replaces a pending union return only on the selected literal branch."
features: [ts-control-flow-routes, ts-control-flow-route-finally, ts-functions, ts-arrays, ts-objects, ts-type-aliases, ts-unions, ts-numbers, ts-strings, ts-null-undefined, ts-unknown, ts-typeof-operator, ts-literal-types, ts-iteration, ts-closures, ts-errors]
---*/
// A replace/keep parameter chooses return precedence; node preserves the pending payload or substitutes the cleanup field while retaining all side effects.
type FlowValue = number | string | null | undefined | { id: number };
const first = { id: 7 }, second = { id: 7 };
const inputs: FlowValue[] = [-0, NaN, "", "text", undefined, null, first, second];
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
function inspect(input: FlowValue, mode: "replace" | "keep"): void {
  const log: unknown[] = [], state: { value: FlowValue } = { value: input };
  function run(): FlowValue {
    try { log.push("return", input); return input; }
    finally {
      log.push("finally", input); state.value = second;
      if (mode === "replace") { log.push("replace.return", state.value); return state.value; }
      log.push("preserve.return", input);
    }
  }
  const result = run(); log.push("result", result, state.value); same(result, mode === "replace" ? second : input); same(state.value, second);
  assert.compareArray(log, mode === "replace"
    ? ["return", input, "finally", input, "replace.return", second, "result", second, second]
    : ["return", input, "finally", input, "preserve.return", input, "result", input, second]);
}
const modes: ("replace" | "keep")[] = ["replace", "keep"];
for (const input of inputs) for (const mode of modes) inspect(input, mode);
