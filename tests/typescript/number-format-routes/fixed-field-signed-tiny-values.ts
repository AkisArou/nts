/*---
description: toFixed distinguishes negative zero receivers from negative nonzero values that round to zero.
features: [ts-number-format-routes, ts-number-format-route-fixed-notation, ts-numbers, ts-strings, ts-conversions, ts-arrays, ts-tuples, ts-functions, ts-typeof-operator, ts-class, ts-class-fields]
---*/
// Signed zeros and tiny/special values enter fields; node suppresses only the zero receiver sign and preserves negative rounded-zero text.
const rows: [number, number | undefined, string][] = [
  [0.0, 0, "0"], [-0, 0, "0"], [0.0, 7, "0.0000000"], [-0, 7, "0.0000000"], [Number.MIN_VALUE, 20, "0.00000000000000000000"], [-Number.MIN_VALUE, 20, "-0.00000000000000000000"],
  [1e-07, 6, "0.000000"], [-1e-07, 6, "-0.000000"], [9.999999999999998e-08, 7, "0.0000001"], [1.0000000000000001e-07, 7, "0.0000001"], [-9.999999999999998e-08, 7, "-0.0000001"],
  [-1.0000000000000001e-07, 7, "-0.0000001"], [Infinity, 0, "Infinity"], [-Infinity, 20, "-Infinity"], [NaN, 100, "NaN"],
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
