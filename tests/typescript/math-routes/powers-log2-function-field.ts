/*---
description: "A typed function field preserves base-two logarithm inputs and returned special values."
features: [ts-math-routes, ts-math-route-powers-roots, ts-functions, ts-arrays, ts-tuples, ts-numbers, ts-strings, ts-unknown, ts-typeof-operator, ts-iteration, ts-function-types, ts-arrow-functions, ts-objects, ts-type-aliases]
---*/
// A declared function field receives the number and returns log2; node logs every transported input and exact special result through that callable route.
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
function exact(actual: unknown[], expected: unknown[]): void { assert.compareArray(actual, expected); for (let i = 0; i < actual.length; i++) same(actual[i], expected[i]); }
const rows: [number, number][] = [
  [0, -Infinity], [-0, -Infinity], [1, 0], [Infinity, Infinity],
  [-Infinity, NaN], [NaN, NaN], [-0.5, NaN], [-1.5, NaN],
  [-2.5, NaN], [-5e-324, NaN], [-2147483649, NaN], [-4503599627370496, NaN],
  [-9007199254740992, NaN], [-1.7976931348623157e+308, NaN],
];
type LogCall = (input: number, position: number, log: unknown[]) => number;
const operation: { run: LogCall } = { run: (input, position, log) => {
  log.push("input", input); const result = Math.log2(input); log.push("computed", result); return result;
} };
for (let position = 0; position < rows.length; position++) {
  const row = rows[position], log: unknown[] = [], result: number = operation.run(row[0], position, log);
  same(result, row[1]); exact(log, ["input", row[0], "computed", row[1]]);
}
