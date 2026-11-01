/*---
description: Typed equality operands preserve the left value before the right reads its side effect.
features: [ts-control-flow-routes, ts-control-flow-route-short-circuit, ts-functions, ts-iteration, ts-arrays, ts-objects, ts-type-aliases, ts-unions, ts-numbers, ts-strings, ts-null-undefined, ts-unknown, ts-typeof-operator, ts-expressions, ts-tuples, ts-closures]
---*/
// ShortValue operands compare after the left rewrites state; node logs the old left and new right values in order and returns true only for the replacement identity.
type ShortValue = number | string | boolean | null | undefined | { id: number };
const marker = { id: 7 }, replacement = { id: 99 };
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
const rows: [ShortValue, boolean, boolean][] = [[0, false, false], [-0, false, false], [NaN, false, false], ["", false, false], [undefined, false, true], [null, false, true], [false, false, false], [marker, true, false], [7, true, false], ["go", true, false], [true, true, false], [replacement, true, false]];
function inspect(input: ShortValue): void {
  const log: unknown[] = []; let state: ShortValue = input;
  function left(): ShortValue { const value = state; state = replacement; log.push("left", value, "write", state); return value; }
  function right(): ShortValue { log.push("right", state); return state; }
  const actual = left() === right();
  log.push("result", actual); same(actual, Object.is(input, replacement)); same(state, replacement);
  assert.compareArray(log, ["left", input, "write", replacement, "right", replacement, "result", Object.is(input, replacement)]);
}
for (const row of rows) inspect(row[0]);
