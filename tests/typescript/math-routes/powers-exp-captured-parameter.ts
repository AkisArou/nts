/*---
description: "A returned typed closure preserves exponential special inputs and results."
features: [ts-math-routes, ts-math-route-powers-roots, ts-functions, ts-arrays, ts-tuples, ts-numbers, ts-strings, ts-unknown, ts-typeof-operator, ts-iteration, ts-closures, ts-arrow-functions, ts-function-types, ts-objects, ts-type-aliases]
---*/
// A typed closure captures a number parameter and returns its exponential result record; node logs the actual capture and each prescribed special value.
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
function exact(actual: unknown[], expected: unknown[]): void { assert.compareArray(actual, expected); for (let i = 0; i < actual.length; i++) same(actual[i], expected[i]); }
const rows: [number, number][] = [
  [0, 1], [-0, 1], [Infinity, Infinity], [-Infinity, 0],
  [NaN, NaN],
];
type ExpOutput = { input: number; result: number };
function capture(input: number, position: number, log: unknown[]): () => ExpOutput {
  return () => { log.push("input", input); const result = Math.exp(input); log.push("computed", result); return { input, result }; };
}
for (let position = 0; position < rows.length; position++) {
  const row = rows[position], log: unknown[] = [], read = capture(row[0], position, log), output = read();
  same(output.input, row[0]); same(output.result, row[1]); exact(log, ["input", row[0], "computed", row[1]]);
}
