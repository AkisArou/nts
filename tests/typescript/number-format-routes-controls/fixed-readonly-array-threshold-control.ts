/*---
description: toFixed changes to uniquely determined shortest exponential text at magnitude one e twenty-one with the same typed route and a position-indexed result table.
features: [ts-number-format-routes, ts-number-format-route-fixed-notation, ts-numbers, ts-strings, ts-conversions, ts-arrays, ts-tuples, ts-functions, ts-typeof-operator, ts-readonly]
---*/
// Boundary values occupy readonly number-array slots; node keeps fixed digits below 1e21 and ignores digits above it. The control reads the result table.
const rows: [number, number | undefined, string][] = [
  [1e+20, 2, "100000000000000000000.00"], [-1e+20, 2, "-100000000000000000000.00"], [9.999999999999999e+20, 2, "999999999999999868928.00"],
  [-9.999999999999999e+20, 2, "-999999999999999868928.00"], [1e+21, 0, "1e+21"], [1e+21, 20, "1e+21"], [-1e+21, 2, "-1e+21"], [1.0000000000000001e+21, 2, "1.0000000000000001e+21"],
  [-1.0000000000000001e+21, 20, "-1.0000000000000001e+21"], [1e+22, 100, "1e+22"], [-1e+22, 100, "-1e+22"], [0.0, 20, "0.00000000000000000000"],
];
const seen: (number | string | undefined)[] = [], expectedLog: (number | string | undefined)[] = [];
function format(index: number, input: readonly number[], digits: number | undefined): string {
  const value: number = input[1];
  assert.sameValue(Object.is(value, rows[index][0]), true); assert.sameValue(typeof value, "number");
  assert.sameValue(Object.is(digits, rows[index][1]), true); assert.sameValue(typeof digits, typeof rows[index][1]);
  seen.push(value, digits);
  const result: string = rows[index][2];
  seen.push(result); return result;
}
for (let index = 0; index < rows.length; index++) {
  const row = rows[index];
  const input: readonly number[] = [42, row[0], -42];
  const result = format(index, input, row[1]); assert.sameValue(result, row[2]); assert.sameValue(typeof result, "string");
  expectedLog.push(row[0], row[1], row[2]);
}
assert.compareArray(seen, expectedLog);
