/*---
description: "Nested local finally blocks write in inside-out order across return, break and normal completion."
features: [ts-control-flow-routes, ts-control-flow-route-finally, ts-functions, ts-arrays, ts-objects, ts-type-aliases, ts-unions, ts-numbers, ts-strings, ts-null-undefined, ts-unknown, ts-typeof-operator, ts-literal-types, ts-iteration, ts-closures, ts-errors]
---*/
// A return/break/normal parameter selects local exits; node lets outer cleanup observe the inner write and keeps a pending return snapshot unchanged.
type FlowValue = number | string | null | undefined | { id: number };
const first = { id: 7 }, second = { id: 7 };
const inputs: FlowValue[] = [-0, NaN, "", "text", undefined, null, first, second];
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
function inspect(input: FlowValue, mode: "return" | "break" | "normal"): void {
  const log: unknown[] = [], state: { value: FlowValue } = { value: input };
  function run(): FlowValue {
    for (let index = 0; index < 1; index++) {
      try {
        try {
          log.push("try", state.value);
          if (mode === "return") { log.push("return", state.value); return state.value; }
          if (mode === "break") { log.push("break", state.value); break; }
          log.push("normal", state.value);
        } finally { state.value = first; log.push("inner.finally", state.value); }
      } finally { log.push("outer.before", state.value); state.value = second; log.push("outer.finally", state.value); }
      log.push("tail", state.value);
    }
    log.push("loop.exit", state.value); return state.value;
  }
  const result = run(); log.push("result", result, state.value); same(result, mode === "return" ? input : second); same(state.value, second);
  const expected: unknown[] = ["try", input, mode, input, "inner.finally", first, "outer.before", first, "outer.finally", second];
  if (mode === "normal") expected.push("tail", second);
  if (mode !== "return") expected.push("loop.exit", second);
  expected.push("result", mode === "return" ? input : second, second); assert.compareArray(log, expected);
}
const modes: ("return" | "break" | "normal")[] = ["return", "break", "normal"];
for (const input of inputs) for (const mode of modes) inspect(input, mode);
