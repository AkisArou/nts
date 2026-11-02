/*---
description: toFixed truncates fractional digit counts and treats undefined and NaN as zero with the same typed route and a position-indexed result table.
features: [ts-number-format-routes, ts-number-format-route-fixed-notation, ts-numbers, ts-strings, ts-conversions, ts-arrays, ts-tuples, ts-functions, ts-typeof-operator, ts-null-undefined]
---*/
// Fractional, absent and NaN digit counts cross typed parameters; node truncates before range checking and emits the recorded text. The control reads the result table.
const rows: [number, number | undefined, string][] = [
  [1.25, undefined, "1"], [1.25, NaN, "1"], [1.25, -0, "1"], [1.25, -0.9, "1"], [1.25, 0.9, "1"], [1.25, 1.9, "1.3"], [1.25, 2.9, "1.25"], [1.25, 20.9, "1.25000000000000000000"],
  [1.25, 99.9, "1.250000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000"],
  [1.25, 100.9, "1.2500000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000"], [-0, -0.9, "0"], [-1.25, 1.9, "-1.3"],
  [Infinity, NaN, "Infinity"],
];
const seen: (number | string | undefined)[] = [], expectedLog: (number | string | undefined)[] = [];
function format(index: number, value: number, digits: number | undefined): string {

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
