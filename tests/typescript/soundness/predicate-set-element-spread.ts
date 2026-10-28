/*---
description: A lying predicate leaves a string in a claimed numeric Set element through a spread copy.
features: [ts-unsound-predicate, ts-map-set, ts-typeof-operator, ts-conversions, ts-iteration, ts-spread, ts-type-guards, ts-narrowing, ts-unknown]
---*/
// TypeScript trusts the lying predicate for this whole container,
// although a claimed numeric member is a string. Node preserves the actual string.
function isNumberSet(value: unknown): value is Set<number> {
  return true;
}
const set: unknown = new Set<unknown>([2, "7"]);
if (!isNumberSet(set)) throw new Test262Error("predicate rejected the fixture");
const copy = [...set];
assert.sameValue(copy.length, 2);
assert.sameValue(typeof copy[1], "string");
assert.sameValue(JSON.stringify(copy), '[2,"7"]');
