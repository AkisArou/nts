/*---
description: "A loop break runs finally before the post-loop union field read and skips the body tail."
features: [ts-control-flow-routes, ts-control-flow-route-finally, ts-functions, ts-arrays, ts-objects, ts-type-aliases, ts-unions, ts-numbers, ts-strings, ts-null-undefined, ts-unknown, ts-typeof-operator, ts-literal-types, ts-iteration, ts-errors]
---*/
// A break/walk parameter selects exits with union payloads; node records every cleanup and returns the cleanup-written field after either loop exit.
type FlowValue = number | string | null | undefined | { id: number };
const first = { id: 7 }, second = { id: 7 };
const inputs: FlowValue[] = [-0, NaN, "", "text", undefined, null, first, second];
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
function inspect(input: FlowValue, mode: "break" | "walk"): void {
  const log: unknown[] = [], state: { value: FlowValue } = { value: input }; let cleaned = 0;
  for (let index = 0; index < 2; index++) {
    state.value = input;
    try {
      log.push("try", index, state.value);
      if (mode === "break") { log.push("break", index, state.value); break; }
      log.push("keep", index, state.value);
    } finally { state.value = second; cleaned++; log.push("finally", index, state.value); }
    log.push("tail", index, state.value);
  }
  log.push("loop.exit", cleaned, state.value); same(cleaned, mode === "break" ? 1 : 2); same(state.value, second);
  const expected: unknown[] = [];
  if (mode === "break") expected.push("try", 0, input, "break", 0, input, "finally", 0, second);
  else for (let index = 0; index < 2; index++) expected.push("try", index, input, "keep", index, input, "finally", index, second, "tail", index, second);
  expected.push("loop.exit", mode === "break" ? 1 : 2, second); assert.compareArray(log, expected);
}
const modes: ("break" | "walk")[] = ["break", "walk"];
for (const input of inputs) for (const mode of modes) inspect(input, mode);
