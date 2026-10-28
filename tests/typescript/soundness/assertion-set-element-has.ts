/*---
description: A lying assertion function leaves a string in a claimed numeric Set element through has.
features: [ts-unsound-assertion, ts-map-set, ts-typeof-operator, ts-conversions, ts-iteration, ts-destructuring, ts-assertion-functions, ts-narrowing, ts-unknown]
---*/
// TypeScript trusts the lying assertion function for this whole container,
// although a claimed numeric member is a string. Node preserves the actual string.
function assertNumberSet(value: unknown): asserts value is Set<number> {}
const set: unknown = new Set<unknown>(["7"]);
assertNumberSet(set);
// Recover the existing nominal-number member to call the narrow has method.
const [value] = set;
assert.sameValue(typeof value, "string");
assert.sameValue(set.has(value), true);
assert.sameValue(set.has(7), false);
const identities = new Map<unknown, string>([["7", "string"], [7, "number"]]);
assert.sameValue(identities.get(value), "string");
