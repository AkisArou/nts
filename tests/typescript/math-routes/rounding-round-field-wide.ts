/*---
description: "Round through a mutable number field at the binary64 integer-spacing boundaries."
features: [ts-math-routes, ts-math-route-rounding, ts-numbers, ts-arrays, ts-iteration, ts-functions, ts-typeof-operator, ts-tuples, ts-class, ts-class-fields]
---*/
// A class number field carries the 2^52 and 2^53 neighbors; Node keeps integral inputs unchanged and rounds the remaining half upward.
function same(actual: number, expected: number): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, "number"); }
const rows: [number, number][] = [
  [4503599627370495.5, 4503599627370496], [-4503599627370495.5, -4503599627370495], [4503599627370496, 4503599627370496],
  [-4503599627370496, -4503599627370496], [4503599627370497, 4503599627370497], [-4503599627370497, -4503599627370497],
  [9007199254740991, 9007199254740991], [9007199254740992, 9007199254740992], [9007199254740994, 9007199254740994],
  [-9007199254740991, -9007199254740991], [-9007199254740992, -9007199254740992], [-9007199254740994, -9007199254740994],
  [2147483648, 2147483648], [4294967297, 4294967297], [-2147483649, -2147483649],
  [Number.MAX_VALUE, Number.MAX_VALUE], [-Number.MAX_VALUE, -Number.MAX_VALUE], [-0, -0],
  [NaN, NaN],
];
class RoundCell {
  value: number = 0;
  read(position: number, log: number[]): number { log.push(this.value); return Math.round(this.value); }
}
const cell = new RoundCell();
for (let position = 0; position < rows.length; position++) {
  const row = rows[position], log: number[] = [];
  cell.value = row[0]; const actual: number = cell.read(position, log);
  log.push(actual);
  const expected: number[] = [row[0], row[1]];
  assert.compareArray(log, expected);
  for (let i = 0; i < log.length; i++) same(log[i], expected[i]);
  same(actual, row[1]);
}
