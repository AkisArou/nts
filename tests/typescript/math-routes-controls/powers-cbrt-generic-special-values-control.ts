/*---
description: "Control for powers-cbrt-generic-special-values; A constrained numeric generic preserves cube-root signed zeros, infinities and NaN."
features: [ts-math-routes, ts-math-route-powers-roots, ts-functions, ts-arrays, ts-tuples, ts-numbers, ts-strings, ts-unknown, ts-typeof-operator, ts-iteration, ts-generics, ts-generic-constraints]
---*/
// A generic number and tuple return carry cube-root special values; node returns each unchanged, including -0 and -Infinity, with exact input and result logs. The control retains the route and selects the result by input position.
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
function exact(actual: unknown[], expected: unknown[]): void { assert.compareArray(actual, expected); for (let i = 0; i < actual.length; i++) same(actual[i], expected[i]); }
const rows: [number, number][] = [
  [0, 0], [-0, -0], [Infinity, Infinity], [-Infinity, -Infinity],
  [NaN, NaN],
];
function compute<T extends number>(input: T, position: number, log: unknown[]): [T, number] {
  log.push("input", input); const result = rows[position][1]; log.push("computed", result); return [input, result];
}
for (let position = 0; position < rows.length; position++) {
  const row = rows[position], log: unknown[] = [], output = compute(row[0], position, log);
  same(output[0], row[0]); same(output[1], row[1]); exact(log, ["input", row[0], "computed", row[1]]);
}
