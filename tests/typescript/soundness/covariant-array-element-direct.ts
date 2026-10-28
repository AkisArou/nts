/*---
description: A string appended through a wider array remains a string at a numeric index read.
features: [ts-unsound-covariant-array, ts-arrays, ts-conversions, ts-typeof-operator]
---*/
// TypeScript lets number[] flow to unknown[] by covariance, permitting a
// string store into a numeric slot. Node reads the string and + concatenates.
function append(values: unknown[]): void {
  values.push("7");
}
const values: number[] = [2];
append(values);
assert.sameValue(values.length, 2);
assert.sameValue(typeof values[1], "string");
assert.sameValue(String(values[1] + 1), "71");
assert.sameValue(values[1] === 7, false);
assert.sameValue(values[0] + 1, 3);
