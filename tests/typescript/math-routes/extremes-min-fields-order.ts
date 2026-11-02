/*---
description: "Min reads two declared numeric fields and selects negative zero in either order."
features: [ts-math-routes, ts-math-route-extremes, ts-numbers, ts-arrays, ts-iteration, ts-functions, ts-typeof-operator, ts-tuples, ts-interfaces]
---*/
// An interface with two number fields carries min operands; Node chooses negative zero, the smaller wide value, or NaN from either position.
function same(actual: number, expected: number): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, "number"); }
const rows: [number[], number][] = [
  [[-0, 0], -0], [[0, -0], -0], [[-0, -0], -0],
  [[0, 0], 0], [[NaN, Infinity], NaN], [[Infinity, NaN], NaN],
  [[NaN, -Infinity], NaN], [[-Infinity, NaN], NaN], [[NaN, NaN], NaN],
  [[-0.5, 0.5], -0.5], [[2.5, -2.5], -2.5], [[Number.MIN_VALUE, -Number.MIN_VALUE], -Number.MIN_VALUE],
  [[Number.MAX_VALUE, -Number.MAX_VALUE], -Number.MAX_VALUE], [[-4503599627370496, 4503599627370496], -4503599627370496], [[4294967297, -2147483649], -2147483649],
  [[-Infinity, Infinity], -Infinity],
];
interface Bounds { left: number; right: number }
function minimum(input: Bounds, position: number, log: number[]): number { log.push(input.left, input.right); return Math.min(input.left, input.right); }
for (let position = 0; position < rows.length; position++) {
  const row = rows[position], log: number[] = [];
  const input: Bounds = { left: row[0][0], right: row[0][1] }; const actual: number = minimum(input, position, log);
  log.push(actual);
  const expected: number[] = [...row[0], row[1]];
  assert.compareArray(log, expected);
  for (let i = 0; i < log.length; i++) same(log[i], expected[i]);
  same(actual, row[1]);
}
