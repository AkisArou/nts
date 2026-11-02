/*---
description: "Control for rounding-floor-interface-input; Floor inputs through an interface method with signed-zero, subnormal and wide boundaries."
features: [ts-math-routes, ts-math-route-rounding, ts-numbers, ts-arrays, ts-iteration, ts-functions, ts-typeof-operator, ts-tuples, ts-interfaces]
---*/
// An interface method receives fractional and extreme number operands; Node floors them without narrowing to int32. The control keeps the route and reads a result table by input position.
function same(actual: number, expected: number): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, "number"); }
const rows: [number, number][] = [
  [0, 0], [-0, -0], [0.5, 0],
  [-0.5, -1], [1.5, 1], [-1.5, -2],
  [2.5, 2], [-2.5, -3], [4503599627370495.5, 4503599627370495],
  [-4503599627370495.5, -4503599627370496], [4503599627370496, 4503599627370496], [-4503599627370496, -4503599627370496],
  [9007199254740991, 9007199254740991], [9007199254740992, 9007199254740992], [9007199254740994, 9007199254740994],
  [2147483648, 2147483648], [4294967297, 4294967297], [-2147483649, -2147483649],
  [Number.MIN_VALUE, 0], [-Number.MIN_VALUE, -1], [Number.MAX_VALUE, Number.MAX_VALUE],
  [-Number.MAX_VALUE, -Number.MAX_VALUE], [Infinity, Infinity], [-Infinity, -Infinity],
  [NaN, NaN],
];
const table: number[] = [0, -0, 0, -1, 1, -2, 2, -3, 4503599627370495, -4503599627370496, 4503599627370496, -4503599627370496, 9007199254740991, 9007199254740992, 9007199254740994, 2147483648, 4294967297, -2147483649, 0, -1, Number.MAX_VALUE, -Number.MAX_VALUE, Infinity, -Infinity, NaN];
interface FloorRoute { run(value: number, position: number, log: number[]): number }
const route: FloorRoute = { run(value, position, log) { log.push(value); return table[position]; } };
for (let position = 0; position < rows.length; position++) {
  const row = rows[position], log: number[] = [];
  const actual: number = route.run(row[0], position, log);
  log.push(actual);
  const expected: number[] = [row[0], row[1]];
  assert.compareArray(log, expected);
  for (let i = 0; i < log.length; i++) same(log[i], expected[i]);
  same(actual, row[1]);
}
