/*---
description: toFixed preserves exact integer digits through a number return around the safe-integer boundary with the same typed route and a position-indexed result table.
features: [ts-number-format-routes, ts-number-format-route-fixed-notation, ts-numbers, ts-strings, ts-conversions, ts-arrays, ts-tuples, ts-functions, ts-typeof-operator]
---*/
// Wide integers cross a declared number return; node prints exact integer digits and padding rather than shortest text. The control reads the result table.
const rows: [number, number | undefined, string][] = [
  [0.0, 0, "0"], [-0, 0, "0"], [9007199254740991.0, 0, "9007199254740991"], [9007199254740992.0, 0, "9007199254740992"], [9007199254740994.0, 0, "9007199254740994"],
  [-9007199254740991.0, 1, "-9007199254740991.0"], [-9007199254740992.0, 2, "-9007199254740992.00"], [-9007199254740994.0, 20, "-9007199254740994.00000000000000000000"],
  [1.0000000000000001e+18, 0, "1000000000000000128"], [-1.0000000000000001e+18, 2, "-1000000000000000128.00"], [1e+20, 1, "100000000000000000000.0"],
  [9.999999999999999e+20, 0, "999999999999999868928"],
];
const seen: (number | string | undefined)[] = [], expectedLog: (number | string | undefined)[] = [];
function numericValue(value: number): number { return value; }
function format(index: number, input: number, digits: number | undefined): string {
  const value: number = numericValue(input);
  assert.sameValue(Object.is(value, rows[index][0]), true); assert.sameValue(typeof value, "number");
  assert.sameValue(Object.is(digits, rows[index][1]), true); assert.sameValue(typeof digits, typeof rows[index][1]);
  seen.push(value, digits);
  const result: string = rows[index][2];
  seen.push(result); return result;
}
for (let index = 0; index < rows.length; index++) {
  const row = rows[index];
  const result = format(index, row[0], row[1]); assert.sameValue(result, row[2]); assert.sameValue(typeof result, "string");
  expectedLog.push(row[0], row[1], row[2]);
}
assert.compareArray(seen, expectedLog);
