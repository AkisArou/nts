/*---
description: toFixed with no digit argument uses zero digits after typed parameter and return boundaries.
features: [ts-number-format-routes, ts-number-format-route-fixed-notation, ts-numbers, ts-strings, ts-conversions, ts-arrays, ts-tuples, ts-functions, ts-typeof-operator, ts-null-undefined]
---*/
// Numbers pass through a declared return before toFixed with no argument; node rounds to integral text and logs every value.
const rows: [number, number | undefined, string][] = [
  [0.0, undefined, "0"], [-0, undefined, "0"], [0.5, undefined, "1"], [-0.5, undefined, "-1"], [2.5, undefined, "3"], [-2.5, undefined, "-3"], [0.49999999999999994, undefined, "0"],
  [0.5000000000000001, undefined, "1"], [9007199254740992.0, undefined, "9007199254740992"], [Number.MIN_VALUE, undefined, "0"], [-Number.MIN_VALUE, undefined, "-0"],
  [1e+21, undefined, "1e+21"], [Infinity, undefined, "Infinity"], [-Infinity, undefined, "-Infinity"], [NaN, undefined, "NaN"],
];
const seen: (number | string | undefined)[] = [], expectedLog: (number | string | undefined)[] = [];
function numericValue(value: number): number { return value; }
function format(index: number, input: number, digits: number | undefined): string {
  const value: number = numericValue(input);
  assert.sameValue(Object.is(value, rows[index][0]), true); assert.sameValue(typeof value, "number");
  assert.sameValue(Object.is(digits, rows[index][1]), true); assert.sameValue(typeof digits, typeof rows[index][1]);
  seen.push(value, digits);
  const result: string = value.toFixed();
  seen.push(result); return result;
}
for (let index = 0; index < rows.length; index++) {
  const row = rows[index];
  const result = format(index, row[0], row[1]); assert.sameValue(result, row[2]); assert.sameValue(typeof result, "string");
  expectedLog.push(row[0], row[1], row[2]);
}
assert.compareArray(seen, expectedLog);
