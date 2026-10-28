/*---
description: A lying predicate leaves a string in a claimed numeric array element through slice.
features: [ts-unsound-predicate, ts-arrays, ts-typeof-operator, ts-conversions, ts-type-guards, ts-narrowing, ts-unknown]
---*/
// TypeScript trusts the lying predicate for this whole container,
// although a claimed numeric member is a string. Node preserves the actual string.
function isNumberArray(value: unknown): value is number[] {
  return true;
}
const values: unknown = [2, "7"];
if (!isNumberArray(values)) throw new Test262Error("predicate rejected the fixture");
const copy: number[] = values.slice();
assert.sameValue(typeof copy[1], "string");
assert.sameValue(String(copy[1] + 1), "71");
assert.sameValue(JSON.stringify(copy), '[2,"7"]');
