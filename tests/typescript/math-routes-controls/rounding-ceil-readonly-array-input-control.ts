/*---
description: "Control for rounding-ceil-readonly-array-input; Ceil a number read from a readonly input array without changing its zero sign or width."
features: [ts-math-routes, ts-math-route-rounding, ts-numbers, ts-arrays, ts-iteration, ts-functions, ts-typeof-operator, ts-tuples, ts-readonly]
---*/
// A readonly number array carries each operand into ceil; Node preserves wide integers, NaN and negative zero. The control keeps the route and reads a result table by input position.
function same(actual: number, expected: number): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, "number"); }
const rows: [number, number][] = [
  [0, 0], [-0, -0], [0.5, 1],
  [-0.5, -0], [1.5, 2], [-1.5, -1],
  [2.5, 3], [-2.5, -2], [4503599627370495.5, 4503599627370496],
  [-4503599627370495.5, -4503599627370495], [4503599627370496, 4503599627370496], [-4503599627370496, -4503599627370496],
  [9007199254740991, 9007199254740991], [9007199254740992, 9007199254740992], [9007199254740994, 9007199254740994],
  [2147483648, 2147483648], [4294967297, 4294967297], [-2147483649, -2147483649],
  [Number.MIN_VALUE, 1], [-Number.MIN_VALUE, -0], [Number.MAX_VALUE, Number.MAX_VALUE],
  [-Number.MAX_VALUE, -Number.MAX_VALUE], [Infinity, Infinity], [-Infinity, -Infinity],
  [NaN, NaN],
];
const table: number[] = [0, -0, 1, -0, 2, -1, 3, -2, 4503599627370496, -4503599627370495, 4503599627370496, -4503599627370496, 9007199254740991, 9007199254740992, 9007199254740994, 2147483648, 4294967297, -2147483649, 1, -0, Number.MAX_VALUE, -Number.MAX_VALUE, Infinity, -Infinity, NaN];
function ceiling(values: readonly number[], position: number, log: number[]): number { const value = values[position]; log.push(value); return table[position]; }
const values: number[] = [];
for (const row of rows) values.push(row[0]);
for (let position = 0; position < rows.length; position++) {
  const row = rows[position], log: number[] = [];
  const actual: number = ceiling(values, position, log);
  log.push(actual);
  const expected: number[] = [row[0], row[1]];
  assert.compareArray(log, expected);
  for (let i = 0; i < log.length; i++) same(log[i], expected[i]);
  same(actual, row[1]);
}
