/*---
description: "A finally break cancels a pending return and reaches the post-loop union read."
features: [ts-control-flow-routes, ts-control-flow-route-finally, ts-functions, ts-arrays, ts-objects, ts-type-aliases, ts-unions, ts-numbers, ts-strings, ts-null-undefined, ts-unknown, ts-typeof-operator, ts-literal-types, ts-iteration, ts-closures, ts-errors]
---*/
// A break/return parameter controls cleanup precedence; node either returns the saved payload or breaks to the cleanup-written field after the loop.
type FlowValue = number | string | null | undefined | { id: number };
const first = { id: 7 }, second = { id: 7 };
const inputs: FlowValue[] = [-0, NaN, "", "text", undefined, null, first, second];
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
function inspect(input: FlowValue, mode: "break" | "return"): void {
  const log: unknown[] = [], state: { value: FlowValue } = { value: input };
  function run(): FlowValue {
    for (let index = 0; index < 2; index++) {
      try { log.push("return", index, input); return input; }
      finally {
        state.value = second; log.push("finally", index, state.value);
        if (mode === "break") { log.push("replace.break", index, state.value); break; }
        log.push("preserve.return", index, input);
      }
    }
    log.push("loop.exit", state.value); return state.value;
  }
  const result = run(); log.push("result", result, state.value); same(result, mode === "break" ? second : input); same(state.value, second);
  assert.compareArray(log, mode === "break"
    ? ["return", 0, input, "finally", 0, second, "replace.break", 0, second, "loop.exit", second, "result", second, second]
    : ["return", 0, input, "finally", 0, second, "preserve.return", 0, input, "result", input, second]);
}
const modes: ("break" | "return")[] = ["break", "return"];
for (const input of inputs) for (const mode of modes) inspect(input, mode);
