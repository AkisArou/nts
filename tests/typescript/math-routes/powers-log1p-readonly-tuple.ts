/*---
description: "Readonly input and return tuples preserve log1p zero signs and the domain boundary."
features: [ts-math-routes, ts-math-route-powers-roots, ts-functions, ts-arrays, ts-tuples, ts-numbers, ts-strings, ts-unknown, ts-typeof-operator, ts-iteration, ts-readonly, ts-type-aliases]
---*/
// A readonly tuple supplies log1p and receives the returned input/result tuple; node logs signed zeros, the -1 boundary and out-of-domain NaN results.
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
function exact(actual: unknown[], expected: unknown[]): void { assert.compareArray(actual, expected); for (let i = 0; i < actual.length; i++) same(actual[i], expected[i]); }
const rows: [number, number][] = [
  [0, 0], [-0, -0], [-1, -Infinity], [Infinity, Infinity],
  [-Infinity, NaN], [NaN, NaN], [-1.0000000000000002, NaN], [-1.5, NaN],
  [-2.5, NaN], [-2147483649, NaN], [-4503599627370496, NaN], [-9007199254740992, NaN],
  [-1.7976931348623157e+308, NaN],
];
type LogInput = readonly [number];
function compute(input: LogInput, position: number, log: unknown[]): readonly [number, number] {
  log.push("input", input[0]); const result = Math.log1p(input[0]); log.push("computed", result); return [input[0], result];
}
for (let position = 0; position < rows.length; position++) {
  const row = rows[position], input: LogInput = [row[0]], log: unknown[] = [], output = compute(input, position, log);
  same(output[0], row[0]); same(output[1], row[1]); exact(log, ["input", row[0], "computed", row[1]]);
}
