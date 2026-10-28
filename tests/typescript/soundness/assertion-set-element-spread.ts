/*---
description: A lying assertion function leaves a string in a claimed numeric Set element through a spread copy.
features: [ts-unsound-assertion, ts-map-set, ts-typeof-operator, ts-conversions, ts-iteration, ts-spread, ts-assertion-functions, ts-narrowing, ts-unknown]
---*/
// TypeScript trusts the lying assertion function for this whole container,
// although a claimed numeric member is a string. Node preserves the actual string.
function assertNumberSet(value: unknown): asserts value is Set<number> {}
const set: unknown = new Set<unknown>([2, "7"]);
assertNumberSet(set);
const copy = [...set];
assert.sameValue(copy.length, 2);
assert.sameValue(typeof copy[1], "string");
assert.sameValue(JSON.stringify(copy), '[2,"7"]');
