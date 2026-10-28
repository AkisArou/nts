/*---
description: A lying predicate leaves a string in a claimed numeric Set element through a forEach callback.
features: [ts-unsound-predicate, ts-map-set, ts-typeof-operator, ts-conversions, ts-functions, ts-type-guards, ts-narrowing, ts-unknown, ts-template-literals]
---*/
// TypeScript trusts the lying predicate for this whole container,
// although a claimed numeric member is a string. Node preserves the actual string.
function isNumberSet(value: unknown): value is Set<number> {
  return true;
}
const set: unknown = new Set<unknown>([2, "7"]);
if (!isNumberSet(set)) throw new Test262Error("predicate rejected the fixture");
const seen: string[] = [];
set.forEach((value, key, owner) => {
  assert.sameValue(owner, set);
  seen.push(`${typeof value}:${value + 1}/${typeof key}:${key + 1}`);
});
assert.compareArray(seen, ["number:3/number:3", "string:71/string:71"]);
