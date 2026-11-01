/*---
description: "A labeled break crosses nested for-of loops while retained readers keep both iteration bindings."
features: [ts-control-flow-routes, ts-control-flow-route-labels, ts-functions, ts-arrays, ts-objects, ts-type-aliases, ts-unions, ts-numbers, ts-strings, ts-null-undefined, ts-unknown, ts-typeof-operator, ts-closures, ts-arrow-functions, ts-function-types, ts-tuples, ts-literal-types, ts-iteration]
---*/
// Nested for-of loops decide on a first/last parameter and retain each union element and inner step; node stops at the selected value and keeps all old bindings.
type FlowValue = number | string | null | undefined | { id: number };
const first = { id: 7 }, second = { id: 7 };
const inputs: FlowValue[] = [-0, NaN, "", "text", undefined, null, first, second];
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
function inspect(input: FlowValue, mode: "first" | "last"): void {
  const log: unknown[] = [], readers: (() => [number, FlowValue])[] = [];
  const values: FlowValue[] = [input, second]; let index = 0, result: FlowValue = undefined;
  outer: for (const value of values) {
    log.push("outer", index, value);
    for (const step of [0, 1]) {
      readers.push(() => [step, value]); result = value; log.push("inner", index, step, value);
      if (index === (mode === "first" ? 0 : 1) && step === 1) { log.push("break.outer", index, step, value); break outer; }
      log.push("keep", index, step, value);
    }
    log.push("inner.exit", index, value); index++;
  }
  log.push("outer.exit", index, result); same(result, mode === "first" ? input : second); same(index, mode === "first" ? 0 : 1);
  const expected: unknown[] = ["outer", 0, input, "inner", 0, 0, input, "keep", 0, 0, input, "inner", 0, 1, input];
  if (mode === "first") expected.push("break.outer", 0, 1, input);
  else expected.push("keep", 0, 1, input, "inner.exit", 0, input, "outer", 1, second, "inner", 1, 0, second, "keep", 1, 0, second, "inner", 1, 1, second, "break.outer", 1, 1, second);
  expected.push("outer.exit", mode === "first" ? 0 : 1, mode === "first" ? input : second); same(readers.length, mode === "first" ? 2 : 4);
  for (let slot = 0; slot < readers.length; slot++) {
    const seen = readers[slot](), value = slot < 2 ? input : second;
    log.push("read", seen[0], seen[1]); expected.push("read", slot % 2, value); same(seen[0], slot % 2); same(seen[1], value);
  }
  assert.compareArray(log, expected);
}
const modes: ("first" | "last")[] = ["first", "last"];
for (const input of inputs) for (const mode of modes) inspect(input, mode);
