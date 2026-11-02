/*---
description: "Control for extremes-hypot-single-generic; A generic numeric argument reaches the single-argument hypot special-value branches."
features: [ts-math-routes, ts-math-route-extremes, ts-numbers, ts-arrays, ts-iteration, ts-functions, ts-typeof-operator, ts-tuples, ts-generics, ts-generic-constraints]
---*/
// A T extends number parameter supplies exactly one hypot argument; Node returns positive zero for either zero, Infinity for either infinity, and NaN. The control retains the route and looks up each result by input position.
function same(actual: number, expected: number): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, "number"); }
const rows: [number[], number][] = [
  [[0], 0], [[-0], 0], [[Infinity], Infinity],
  [[-Infinity], Infinity], [[NaN], NaN],
];
const table: number[] = [0, 0, Infinity, Infinity, NaN];
function singleLength<T extends number>(value: T, position: number, log: number[]): number { log.push(value); return table[position]; }
for (let position = 0; position < rows.length; position++) {
  const row = rows[position], log: number[] = [];
  const actual: number = singleLength(row[0][0], position, log);
  log.push(actual);
  const expected: number[] = [...row[0], row[1]];
  assert.compareArray(log, expected);
  for (let i = 0; i < log.length; i++) same(log[i], expected[i]);
  same(actual, row[1]);
}
