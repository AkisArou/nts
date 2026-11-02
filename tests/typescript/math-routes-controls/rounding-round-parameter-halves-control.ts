/*---
description: "Control for rounding-round-parameter-halves; Round a number parameter and return ties toward positive infinity with exact signed zero."
features: [ts-math-routes, ts-math-route-rounding, ts-numbers, ts-arrays, ts-iteration, ts-functions, ts-typeof-operator, ts-tuples]
---*/
// Halves and adjacent doubles cross a number parameter and return; Node rounds negative ties upward and preserves negative zero. The control keeps the route and reads a result table by input position.
function same(actual: number, expected: number): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, "number"); }
const rows: [number, number][] = [
  [0, 0], [-0, -0], [0.5, 1],
  [-0.5, -0], [1.5, 2], [-1.5, -1],
  [2.5, 3], [-2.5, -2], [0.49999999999999994, 0],
  [-0.49999999999999994, -0], [0.5000000000000001, 1], [-0.5000000000000001, -1],
  [Number.MIN_VALUE, 0], [-Number.MIN_VALUE, -0], [Infinity, Infinity],
  [-Infinity, -Infinity], [NaN, NaN],
];
const table: number[] = [0, -0, 1, -0, 2, -1, 3, -2, 0, -0, 1, -1, 0, -0, Infinity, -Infinity, NaN];
function rounded(value: number, position: number, log: number[]): number { log.push(value); return table[position]; }
for (let position = 0; position < rows.length; position++) {
  const row = rows[position], log: number[] = [];
  const actual: number = rounded(row[0], position, log);
  log.push(actual);
  const expected: number[] = [row[0], row[1]];
  assert.compareArray(log, expected);
  for (let i = 0; i < log.length; i++) same(log[i], expected[i]);
  same(actual, row[1]);
}
