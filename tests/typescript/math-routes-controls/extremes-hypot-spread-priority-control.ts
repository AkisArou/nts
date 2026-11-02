/*---
description: "Control for extremes-hypot-spread-priority; Hypot sees infinities before NaN through a typed spread route and returns positive zero for all-zero input."
features: [ts-math-routes, ts-math-route-extremes, ts-numbers, ts-arrays, ts-iteration, ts-functions, ts-typeof-operator, ts-tuples, ts-readonly, ts-spread]
---*/
// A number-array parameter carries hypot operands; Node returns Infinity despite NaN anywhere, NaN without infinity, and positive zero for empty or all-zero inputs. The control retains the route and looks up each result by input position.
function same(actual: number, expected: number): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, "number"); }
const rows: [number[], number][] = [
  [[], 0], [[-0], 0], [[0, -0], 0],
  [[-0, 0, -0], 0], [[NaN], NaN], [[NaN, 0], NaN],
  [[0, NaN, -0], NaN], [[0, -0, NaN], NaN], [[NaN, Infinity], Infinity],
  [[Infinity, NaN], Infinity], [[NaN, -Infinity], Infinity], [[-Infinity, NaN], Infinity],
  [[NaN, 0, Infinity], Infinity], [[Infinity, 0, NaN], Infinity], [[0, -Infinity, NaN], Infinity],
  [[NaN, -Infinity, Infinity], Infinity], [[Number.MAX_VALUE, NaN, Infinity], Infinity], [[Number.MIN_VALUE, NaN, -Infinity], Infinity],
];
const table: number[] = [0, 0, 0, 0, NaN, NaN, NaN, NaN, Infinity, Infinity, Infinity, Infinity, Infinity, Infinity, Infinity, Infinity, Infinity, Infinity];
function lengthOf(values: readonly number[], position: number, log: number[]): number { for (const value of values) log.push(value); return table[position]; }
for (let position = 0; position < rows.length; position++) {
  const row = rows[position], log: number[] = [];
  const actual: number = lengthOf(row[0], position, log);
  log.push(actual);
  const expected: number[] = [...row[0], row[1]];
  assert.compareArray(log, expected);
  for (let i = 0; i < log.length; i++) same(log[i], expected[i]);
  same(actual, row[1]);
}
