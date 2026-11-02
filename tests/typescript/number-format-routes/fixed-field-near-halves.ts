/*---
description: toFixed rounds the exact stored binary value rather than the spelling of near-half decimal inputs.
features: [ts-number-format-routes, ts-number-format-route-fixed-notation, ts-numbers, ts-strings, ts-conversions, ts-arrays, ts-tuples, ts-functions, ts-typeof-operator, ts-class, ts-class-fields]
---*/
// Near halves enter mutable number fields; the operand/text log distinguishes binary rounding from decimal-literal rounding.
const rows: [number, number | undefined, string][] = [
  [0.49999999999999994, 0, "0"], [0.5, 0, "1"], [0.5000000000000001, 0, "1"], [2.5, 0, "3"], [-2.5, 0, "-3"], [1.005, 2, "1.00"], [1.0050000000000001, 2, "1.01"], [2.675, 2, "2.67"],
  [2.6750000000000003, 2, "2.68"], [1.125, 2, "1.13"], [-1.125, 2, "-1.13"], [1.25, 1, "1.3"], [1.2345, 3, "1.234"], [-1.2345, 3, "-1.234"], [0.1, 20, "0.10000000000000000555"],
  [0.3, 20, "0.29999999999999998890"], [1.005, 20, "1.00499999999999989342"], [-1.005, 20, "-1.00499999999999989342"],
];
const seen: (number | string | undefined)[] = [], expectedLog: (number | string | undefined)[] = [];
class FixedSlot { value: number = 0; digits: number | undefined = 0; }
function format(index: number, slot: FixedSlot): string {
  const value = slot.value, digits = slot.digits;
  assert.sameValue(Object.is(value, rows[index][0]), true); assert.sameValue(typeof value, "number");
  assert.sameValue(Object.is(digits, rows[index][1]), true); assert.sameValue(typeof digits, typeof rows[index][1]);
  seen.push(value, digits);
  const result: string = value.toFixed(digits);
  seen.push(result); return result;
}
for (let index = 0; index < rows.length; index++) {
  const row = rows[index];
  const slot = new FixedSlot(); slot.value = row[0]; slot.digits = row[1];
  const result = format(index, slot); assert.sameValue(result, row[2]); assert.sameValue(typeof result, "string");
  expectedLog.push(row[0], row[1], row[2]);
}
assert.compareArray(seen, expectedLog);
