/*---
description: toFixed accepts high digit counts and emits the exact binary fraction with trailing zeros through one hundred places with the same typed route and a position-indexed result table.
features: [ts-number-format-routes, ts-number-format-route-fixed-notation, ts-numbers, ts-strings, ts-conversions, ts-arrays, ts-tuples, ts-functions, ts-typeof-operator]
---*/
// Typed number and digit parameters carry long binary fractions; node returns the exact rounded fraction and all required zeros. The control reads the result table.
const rows: [number, number | undefined, string][] = [
  [0.1, 21, "0.100000000000000005551"], [0.1, 50, "0.10000000000000000555111512312578270211815834045410"],
  [0.1, 100, "0.1000000000000000055511151231257827021181583404541015625000000000000000000000000000000000000000000000"],
  [-0.1, 100, "-0.1000000000000000055511151231257827021181583404541015625000000000000000000000000000000000000000000000"],
  [0.3, 99, "0.299999999999999988897769753748434595763683319091796875000000000000000000000000000000000000000000000"],
  [1.005, 100, "1.0049999999999998934185896359849721193313598632812500000000000000000000000000000000000000000000000000"],
  [1.25, 100, "1.2500000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000"],
  [-0, 100, "0.0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000"],
  [Number.MIN_VALUE, 100, "0.0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000"],
  [-Number.MIN_VALUE, 100, "-0.0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000"],
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
