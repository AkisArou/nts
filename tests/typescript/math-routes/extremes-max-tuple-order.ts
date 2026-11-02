/*---
description: "Max selects positive zero in either operand order through a readonly tuple parameter."
features: [ts-math-routes, ts-math-route-extremes, ts-numbers, ts-arrays, ts-iteration, ts-functions, ts-typeof-operator, ts-tuples, ts-readonly]
---*/
// A readonly two-number tuple carries signed zeros, NaN and extremes into max; Node chooses positive zero and propagates either NaN operand.
function same(actual: number, expected: number): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, "number"); }
const rows: [number[], number][] = [
  [[-0, 0], 0], [[0, -0], 0], [[-0, -0], -0],
  [[0, 0], 0], [[NaN, Infinity], NaN], [[Infinity, NaN], NaN],
  [[NaN, -Infinity], NaN], [[-Infinity, NaN], NaN], [[NaN, NaN], NaN],
  [[-0.5, 0.5], 0.5], [[2.5, -2.5], 2.5], [[Number.MIN_VALUE, -Number.MIN_VALUE], Number.MIN_VALUE],
  [[Number.MAX_VALUE, -Number.MAX_VALUE], Number.MAX_VALUE], [[9007199254740991, 9007199254740992], 9007199254740992], [[9007199254740994, 9007199254740992], 9007199254740994],
  [[-Infinity, Infinity], Infinity],
];
function maximum(pair: readonly [number, number], position: number, log: number[]): number { log.push(pair[0], pair[1]); return Math.max(pair[0], pair[1]); }
for (let position = 0; position < rows.length; position++) {
  const row = rows[position], log: number[] = [];
  const pair: readonly [number, number] = [row[0][0], row[0][1]]; const actual: number = maximum(pair, position, log);
  log.push(actual);
  const expected: number[] = [...row[0], row[1]];
  assert.compareArray(log, expected);
  for (let i = 0; i < log.length; i++) same(log[i], expected[i]);
  same(actual, row[1]);
}
