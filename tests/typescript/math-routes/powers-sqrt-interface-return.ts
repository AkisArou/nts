/*---
description: "An interface field and declared result record preserve exact square roots and exceptional values."
features: [ts-math-routes, ts-math-route-powers-roots, ts-functions, ts-arrays, ts-tuples, ts-numbers, ts-strings, ts-unknown, ts-typeof-operator, ts-iteration, ts-interfaces, ts-objects]
---*/
// An interface field supplies square-root inputs; node logs inputs and exact prescribed results, including negative zero and the smallest positive subnormal.
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
function exact(actual: unknown[], expected: unknown[]): void { assert.compareArray(actual, expected); for (let i = 0; i < actual.length; i++) same(actual[i], expected[i]); }
const rows: [number, number][] = [
  [0, 0], [-0, -0], [Infinity, Infinity], [-Infinity, NaN],
  [NaN, NaN], [-0.5, NaN], [-1.5, NaN], [-2.5, NaN],
  [-5e-324, NaN], [-1.7976931348623157e+308, NaN], [0.25, 0.5], [1, 1],
  [2.25, 1.5], [6.25, 2.5], [4, 2], [9, 3],
  [4503599627370496, 67108864], [5e-324, 2.2227587494850775e-162],
];
interface SqrtInput { value: number; }
interface SqrtOutput { input: number; result: number; }
function compute(view: SqrtInput, position: number, log: unknown[]): SqrtOutput {
  const input = view.value; log.push("input", input); const result = Math.sqrt(input); log.push("computed", result); return { input, result };
}
for (let position = 0; position < rows.length; position++) {
  const row = rows[position], input: SqrtInput = { value: row[0] }, log: unknown[] = [], output = compute(input, position, log);
  same(input.value, row[0]); same(output.input, row[0]); same(output.result, row[1]); exact(log, ["input", row[0], "computed", row[1]]);
}
