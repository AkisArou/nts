/*---
description: "Max spreads a typed array parameter including empty arrays and NaN in each position."
features: [ts-math-routes, ts-math-route-extremes, ts-numbers, ts-arrays, ts-iteration, ts-functions, ts-typeof-operator, ts-tuples, ts-readonly, ts-spread]
---*/
// A readonly array parameter supplies max spread arguments; Node returns -Infinity for empty input and preserves zero preference and NaN at any position.
function same(actual: number, expected: number): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, "number"); }
const rows: [number[], number][] = [
  [[], -Infinity], [[-0], -0], [[0], 0],
  [[-0, 0], 0], [[0, -0], 0], [[-0, -0], -0],
  [[NaN, -1, 1], NaN], [[-1, NaN, 1], NaN], [[-1, 1, NaN], NaN],
  [[Infinity, NaN, -Infinity], NaN], [[-Infinity, NaN, Infinity], NaN], [[-2.5, -1.5, -0.5], -0.5],
  [[0.5, 1.5, 2.5], 2.5], [[4503599627370496, 9007199254740991, 9007199254740992, 9007199254740994], 9007199254740994], [[2147483648, 4294967297, -2147483649], 4294967297],
  [[Number.MIN_VALUE, -Number.MIN_VALUE], Number.MIN_VALUE], [[Number.MAX_VALUE, -Number.MAX_VALUE], Number.MAX_VALUE], [[-Infinity, Infinity], Infinity],
];
function spreadMaximum(values: readonly number[], position: number, log: number[]): number { for (const value of values) log.push(value); return Math.max(...values); }
for (let position = 0; position < rows.length; position++) {
  const row = rows[position], log: number[] = [];
  const actual: number = spreadMaximum(row[0], position, log);
  log.push(actual);
  const expected: number[] = [...row[0], row[1]];
  assert.compareArray(log, expected);
  for (let i = 0; i < log.length; i++) same(log[i], expected[i]);
  same(actual, row[1]);
}
