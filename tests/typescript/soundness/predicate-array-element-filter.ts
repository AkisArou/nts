/*---
description: A lying predicate leaves a string in a claimed numeric array element through filter.
features: [ts-unsound-predicate, ts-arrays, ts-typeof-operator, ts-conversions, ts-functions, ts-type-guards, ts-narrowing, ts-unknown]
---*/
// TypeScript trusts the lying predicate for this whole container,
// although a claimed numeric member is a string. Node preserves the actual string.
function isNumberArray(value: unknown): value is number[] {
  return true;
}
const values: unknown = [2, "7"];
if (!isNumberArray(values)) throw new Test262Error("predicate rejected the fixture");
const kept: number[] = values.filter((value: number) => value !== 2);
assert.sameValue(kept.length, 1);
assert.sameValue(typeof kept[0], "string");
assert.sameValue(String(kept[0] + 1), "71");
assert.sameValue(kept[0] === 7, false);
