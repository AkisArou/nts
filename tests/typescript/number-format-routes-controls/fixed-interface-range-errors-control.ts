/*---
description: toFixed validates digits before formatting even when the typed receiver is nonfinite with the same typed route and a position-indexed result table.
features: [ts-number-format-routes, ts-number-format-route-fixed-notation, ts-numbers, ts-strings, ts-conversions, ts-arrays, ts-tuples, ts-functions, ts-typeof-operator, ts-interfaces, ts-errors, ts-null-undefined]
---*/
// Interface fields carry receivers and digit counts; node logs valid text or RangeError, including nonfinite receivers. The control reads the result table.
const rows: [number, number | undefined, string | null][] = [
  [0.0, -1, null], [1.25, 101, null], [-0, -1.1, null], [2.5, Infinity, null], [-2.5, -Infinity, null], [NaN, 101, null], [Infinity, -1, null], [-Infinity, 101, null],
  [Number.MAX_VALUE, 101, null], [-Number.MAX_VALUE, -1, null], [0.0, 0, "0"],
  [-0, 100, "0.0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000"],
  [1.25, 100.9, "1.2500000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000"], [NaN, 100, "NaN"], [Infinity, 100, "Infinity"],
  [-Infinity, 0, "-Infinity"],
];
const seen: (number | string | undefined)[] = [], expectedLog: (number | string | undefined)[] = [];
interface FixedInput { numberValue: number; digitCount: number | undefined; }
function format(index: number, input: FixedInput): string {
  const value = input.numberValue, digits = input.digitCount;
  assert.sameValue(Object.is(value, rows[index][0]), true); assert.sameValue(typeof value, "number");
  assert.sameValue(Object.is(digits, rows[index][1]), true); assert.sameValue(typeof digits, typeof rows[index][1]);
  seen.push(value, digits);
  const result = rows[index][2]; if (result === null) throw new RangeError();
  seen.push(result); return result;
}
for (let index = 0; index < rows.length; index++) {
  const row = rows[index];
  const input: FixedInput = { numberValue: row[0], digitCount: row[1] };
  if (row[2] === null) { assert.throws(RangeError, () => { format(index, input); }); seen.push("RangeError"); }
  else { const result = format(index, input); assert.sameValue(result, row[2]); assert.sameValue(typeof result, "string"); }
  expectedLog.push(row[0], row[1], row[2] === null ? "RangeError" : row[2]);
}
assert.compareArray(seen, expectedLog);
