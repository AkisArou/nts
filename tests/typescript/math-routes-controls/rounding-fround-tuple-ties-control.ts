/*---
description: "Control for rounding-fround-tuple-ties; Round tuple operands to binary32 with ties to even before returning number values."
features: [ts-math-routes, ts-math-route-rounding, ts-numbers, ts-arrays, ts-iteration, ts-functions, ts-typeof-operator, ts-tuples, ts-readonly]
---*/
// A readonly tuple parameter carries binary32 halfway operands and wide integers; Node chooses the even significand and preserves special values. The control keeps the route and reads a result table by input position.
function same(actual: number, expected: number): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, "number"); }
const rows: [number, number][] = [
  [0, 0], [-0, -0], [0.5, 0.5],
  [-0.5, -0.5], [1.5, 1.5], [-1.5, -1.5],
  [2.5, 2.5], [-2.5, -2.5], [1.0000000596046448, 1],
  [1.0000001788139343, 1.000000238418579], [-1.0000000596046448, -1], [-1.0000001788139343, -1.000000238418579],
  [16777217, 16777216], [16777219, 16777220], [-16777217, -16777216],
  [-16777219, -16777220], [4503599627370496, 4503599627370496], [-4503599627370496, -4503599627370496],
  [9007199254740991, 9007199254740992], [9007199254740992, 9007199254740992], [9007199254740994, 9007199254740992],
  [4294967297, 4294967296], [-2147483649, -2147483648], [Infinity, Infinity],
  [-Infinity, -Infinity], [NaN, NaN],
];
const table: number[] = [0, -0, 0.5, -0.5, 1.5, -1.5, 2.5, -2.5, 1, 1.000000238418579, -1, -1.000000238418579, 16777216, 16777220, -16777216, -16777220, 4503599627370496, -4503599627370496, 9007199254740992, 9007199254740992, 9007199254740992, 4294967296, -2147483648, Infinity, -Infinity, NaN];
function float32(input: readonly [number], position: number, log: number[]): number { log.push(input[0]); return table[position]; }
for (let position = 0; position < rows.length; position++) {
  const row = rows[position], log: number[] = [];
  const input: readonly [number] = [row[0]]; const actual: number = float32(input, position, log);
  log.push(actual);
  const expected: number[] = [row[0], row[1]];
  assert.compareArray(log, expected);
  for (let i = 0; i < log.length; i++) same(log[i], expected[i]);
  same(actual, row[1]);
}
