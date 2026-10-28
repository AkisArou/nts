/*---
description: Filtering numeric elements distinguishes an injected string from the equal-looking number.
features: [ts-unsound-covariant-array, ts-arrays, ts-arrow-functions, ts-conversions, ts-typeof-operator]
---*/
// TypeScript accepts number[] as unknown[], allowing a string into the
// numeric array. Node's filter keeps that string because "7" is not 7.
function append(values: unknown[]): void {
  values.push("7");
}
const values: number[] = [7];
append(values);
const kept: number[] = values.filter((value: number) => value !== 7);
assert.sameValue(kept.length, 1);
assert.sameValue(typeof kept[0], "string");
assert.sameValue(String(kept[0] + 1), "71");
