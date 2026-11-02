/*---
description: "Control for rounding-trunc-return-input; Truncate numbers after a declared numeric return with exact wide values and signed zero."
features: [ts-math-routes, ts-math-route-rounding, ts-numbers, ts-arrays, ts-iteration, ts-functions, ts-typeof-operator, ts-tuples]
---*/
// A number-returning function carries halves and binary64 boundaries to trunc; Node removes fractions while keeping zero sign. The control keeps the route and reads a result table by input position.
function same(actual: number, expected: number): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, "number"); }
const rows: [number, number][] = [
  [0, 0], [-0, -0], [0.5, 0],
  [-0.5, -0], [1.5, 1], [-1.5, -1],
  [2.5, 2], [-2.5, -2], [4503599627370495.5, 4503599627370495],
  [-4503599627370495.5, -4503599627370495], [4503599627370496, 4503599627370496], [-4503599627370496, -4503599627370496],
  [9007199254740991, 9007199254740991], [9007199254740992, 9007199254740992], [9007199254740994, 9007199254740994],
  [2147483648, 2147483648], [4294967297, 4294967297], [-2147483649, -2147483649],
  [Number.MIN_VALUE, 0], [-Number.MIN_VALUE, -0], [Number.MAX_VALUE, Number.MAX_VALUE],
  [-Number.MAX_VALUE, -Number.MAX_VALUE], [Infinity, Infinity], [-Infinity, -Infinity],
  [NaN, NaN],
];
const table: number[] = [0, -0, 0, -0, 1, -1, 2, -2, 4503599627370495, -4503599627370495, 4503599627370496, -4503599627370496, 9007199254740991, 9007199254740992, 9007199254740994, 2147483648, 4294967297, -2147483649, 0, -0, Number.MAX_VALUE, -Number.MAX_VALUE, Infinity, -Infinity, NaN];
function readInput(value: number): number { return value; }
for (let position = 0; position < rows.length; position++) {
  const row = rows[position], log: number[] = [];
  const value: number = readInput(row[0]); log.push(value); const actual: number = table[position];
  log.push(actual);
  const expected: number[] = [row[0], row[1]];
  assert.compareArray(log, expected);
  for (let i = 0; i < log.length; i++) same(log[i], expected[i]);
  same(actual, row[1]);
}
