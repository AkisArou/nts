/*---
description: "Control for rounding-fround-field-range; Read binary32 underflow and overflow boundaries through a declared numeric field."
features: [ts-math-routes, ts-math-route-rounding, ts-numbers, ts-arrays, ts-iteration, ts-functions, ts-typeof-operator, ts-tuples, ts-interfaces]
---*/
// A numeric field carries binary32 subnormal and overflow ties; Node preserves signed underflow zeros, rounds ties to even and overflows to infinities. The control keeps the route and reads a result table by input position.
function same(actual: number, expected: number): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, "number"); }
const rows: [number, number][] = [
  [0, 0], [-0, -0], [Number.MIN_VALUE, 0],
  [-Number.MIN_VALUE, -0], [7.006492321624085e-46, 0], [-7.006492321624085e-46, -0],
  [1.401298464324817e-45, 1.401298464324817e-45], [-1.401298464324817e-45, -1.401298464324817e-45], [2.1019476964872256e-45, 2.802596928649634e-45],
  [-2.1019476964872256e-45, -2.802596928649634e-45], [1.1754942807573643e-38, 1.1754943508222875e-38], [-1.1754942807573643e-38, -1.1754943508222875e-38],
  [3.4028234663852886e38, 3.4028234663852886e38], [-3.4028234663852886e38, -3.4028234663852886e38], [3.4028235677973366e38, Infinity],
  [-3.4028235677973366e38, -Infinity], [Number.MAX_VALUE, Infinity], [-Number.MAX_VALUE, -Infinity],
  [NaN, NaN],
];
const table: number[] = [0, -0, 0, -0, 0, -0, 1.401298464324817e-45, -1.401298464324817e-45, 2.802596928649634e-45, -2.802596928649634e-45, 1.1754943508222875e-38, -1.1754943508222875e-38, 3.4028234663852886e38, -3.4028234663852886e38, Infinity, -Infinity, Infinity, -Infinity, NaN];
interface FloatInput { value: number }
function narrow(input: FloatInput, position: number, log: number[]): number { log.push(input.value); return table[position]; }
for (let position = 0; position < rows.length; position++) {
  const row = rows[position], log: number[] = [];
  const input: FloatInput = { value: row[0] }; const actual: number = narrow(input, position, log);
  log.push(actual);
  const expected: number[] = [row[0], row[1]];
  assert.compareArray(log, expected);
  for (let i = 0; i < log.length; i++) same(log[i], expected[i]);
  same(actual, row[1]);
}
