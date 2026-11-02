/*---
description: "Control for rounding-sign-union-parameter; Sign consumes a number-or-string-or-null parameter after explicit narrowing."
features: [ts-math-routes, ts-math-route-rounding, ts-numbers, ts-arrays, ts-iteration, ts-functions, ts-tuples, ts-unions, ts-null-undefined, ts-strings, ts-typeof-operator]
---*/
// A number|string|null parameter is narrowed to a number; Node sign keeps signed zeros and NaN and returns unit signs for nonzero magnitudes.
function same(actual: number, expected: number): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, "number"); }
const rows: [number | string | null, number, number][] = [
  [0, 0, 0], [-0, -0, -0], [0.5, 0.5, 1],
  [-0.5, -0.5, -1], [1.5, 1.5, 1], [-1.5, -1.5, -1],
  [2.5, 2.5, 1], [-2.5, -2.5, -1], [4503599627370496, 4503599627370496, 1],
  [-4503599627370496, -4503599627370496, -1], [9007199254740992, 9007199254740992, 1], [Number.MIN_VALUE, Number.MIN_VALUE, 1],
  [-Number.MIN_VALUE, -Number.MIN_VALUE, -1], [Number.MAX_VALUE, Number.MAX_VALUE, 1], [-Number.MAX_VALUE, -Number.MAX_VALUE, -1],
  [Infinity, Infinity, 1], [-Infinity, -Infinity, -1], [NaN, NaN, NaN],
  ["-0", -0, -0], ["-2.5", -2.5, -1], ["NaN", NaN, NaN],
  [null, 0, 0],
];
const table: number[] = [0, -0, 1, -1, 1, -1, 1, -1, 1, -1, 1, 1, -1, 1, -1, 1, -1, NaN, -0, -1, NaN, 0];
function signed(input: number | string | null, position: number, log: number[]): number {
  assert.sameValue(Object.is(input, rows[position][0]), true); assert.sameValue(typeof input, typeof rows[position][0]);
  const value = typeof input === "number" ? input : input === null ? 0 : Number(input);
  log.push(value); return table[position];
}
for (let position = 0; position < rows.length; position++) {
  const row = rows[position], log: number[] = [];
  const actual: number = signed(row[0], position, log); log.push(actual);
  const expected: number[] = [row[1], row[2]];
  assert.compareArray(log, expected);
  for (let i = 0; i < log.length; i++) same(log[i], expected[i]);
  same(actual, row[2]);
}
