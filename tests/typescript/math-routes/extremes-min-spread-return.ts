/*---
description: "Min consumes a returned number array with empty and mixed signed-zero inputs."
features: [ts-math-routes, ts-math-route-extremes, ts-numbers, ts-arrays, ts-iteration, ts-functions, ts-typeof-operator, ts-tuples, ts-spread]
---*/
// A declared number-array return supplies min spread operands; Node returns Infinity for no elements and negative zero whenever a zero minimum includes it.
function same(actual: number, expected: number): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, "number"); }
const rows: [number[], number][] = [
  [[], Infinity], [[-0], -0], [[0], 0],
  [[-0, 0], -0], [[0, -0], -0], [[-0, -0], -0],
  [[NaN, -1, 1], NaN], [[-1, NaN, 1], NaN], [[-1, 1, NaN], NaN],
  [[Infinity, NaN, -Infinity], NaN], [[-Infinity, NaN, Infinity], NaN], [[-2.5, -1.5, -0.5], -2.5],
  [[0.5, 1.5, 2.5], 0.5], [[4503599627370496, 9007199254740991, 9007199254740992, 9007199254740994], 4503599627370496], [[2147483648, 4294967297, -2147483649], -2147483649],
  [[Number.MIN_VALUE, -Number.MIN_VALUE], -Number.MIN_VALUE], [[Number.MAX_VALUE, -Number.MAX_VALUE], -Number.MAX_VALUE], [[-Infinity, Infinity], -Infinity],
];
function valuesFrom(values: number[]): number[] { return values; }
for (let position = 0; position < rows.length; position++) {
  const row = rows[position], log: number[] = [];
  const values: number[] = valuesFrom(row[0]); for (const value of values) log.push(value); const actual: number = Math.min(...values);
  log.push(actual);
  const expected: number[] = [...row[0], row[1]];
  assert.compareArray(log, expected);
  for (let i = 0; i < log.length; i++) same(log[i], expected[i]);
  same(actual, row[1]);
}
