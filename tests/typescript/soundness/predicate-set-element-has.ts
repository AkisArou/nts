/*---
description: A lying predicate leaves a string in a claimed numeric Set element through has.
features: [ts-unsound-predicate, ts-map-set, ts-typeof-operator, ts-conversions, ts-iteration, ts-destructuring, ts-type-guards, ts-narrowing, ts-unknown]
---*/
// TypeScript trusts the lying predicate for this whole container,
// although a claimed numeric member is a string. Node preserves the actual string.
function isNumberSet(value: unknown): value is Set<number> {
  return true;
}
const set: unknown = new Set<unknown>(["7"]);
if (!isNumberSet(set)) throw new Test262Error("predicate rejected the fixture");
// Recover the existing nominal-number member to call the narrow has method.
const [value] = set;
assert.sameValue(typeof value, "string");
assert.sameValue(set.has(value), true);
assert.sameValue(set.has(7), false);
const identities = new Map<unknown, string>([["7", "string"], [7, "number"]]);
assert.sameValue(identities.get(value), "string");
