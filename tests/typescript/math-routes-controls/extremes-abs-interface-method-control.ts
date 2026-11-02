/*---
description: "Control for extremes-abs-interface-method; Abs through an interface method returns positive zero without changing finite magnitude."
features: [ts-math-routes, ts-math-route-extremes, ts-numbers, ts-arrays, ts-iteration, ts-functions, ts-typeof-operator, ts-tuples, ts-interfaces]
---*/
// An interface method receives signed zeros, subnormals and large numbers; Node abs returns a nonnegative magnitude, positive zero, or NaN. The control retains the route and looks up each result by input position.
function same(actual: number, expected: number): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, "number"); }
const rows: [number[], number][] = [
  [[0], 0], [[-0], 0], [[0.5], 0.5],
  [[-0.5], 0.5], [[1.5], 1.5], [[-1.5], 1.5],
  [[2.5], 2.5], [[-2.5], 2.5], [[4503599627370496], 4503599627370496],
  [[-4503599627370496], 4503599627370496], [[9007199254740991], 9007199254740991], [[9007199254740992], 9007199254740992],
  [[9007199254740994], 9007199254740994], [[2147483648], 2147483648], [[4294967297], 4294967297],
  [[-2147483649], 2147483649], [[Number.MIN_VALUE], Number.MIN_VALUE], [[-Number.MIN_VALUE], Number.MIN_VALUE],
  [[Number.MAX_VALUE], Number.MAX_VALUE], [[-Number.MAX_VALUE], Number.MAX_VALUE], [[Infinity], Infinity],
  [[-Infinity], Infinity], [[NaN], NaN],
];
const table: number[] = [0, 0, 0.5, 0.5, 1.5, 1.5, 2.5, 2.5, 4503599627370496, 4503599627370496, 9007199254740991, 9007199254740992, 9007199254740994, 2147483648, 4294967297, 2147483649, Number.MIN_VALUE, Number.MIN_VALUE, Number.MAX_VALUE, Number.MAX_VALUE, Infinity, Infinity, NaN];
interface Magnitude { read(value: number, position: number, log: number[]): number }
const route: Magnitude = { read(value, position, log) { log.push(value); return table[position]; } };
for (let position = 0; position < rows.length; position++) {
  const row = rows[position], log: number[] = [];
  const actual: number = route.read(row[0][0], position, log);
  log.push(actual);
  const expected: number[] = [...row[0], row[1]];
  assert.compareArray(log, expected);
  for (let i = 0; i < log.length; i++) same(log[i], expected[i]);
  same(actual, row[1]);
}
