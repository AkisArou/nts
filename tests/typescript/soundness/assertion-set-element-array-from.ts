/*---
description: A lying assertion function leaves a string in a claimed numeric Set element through Array.from without a mapper.
features: [ts-unsound-assertion, ts-map-set, ts-typeof-operator, ts-conversions, ts-iteration, ts-arrays, ts-assertion-functions, ts-narrowing, ts-unknown]
---*/
// TypeScript trusts the lying assertion function for this whole container,
// although a claimed numeric member is a string. Node preserves the actual string.
function assertNumberSet(value: unknown): asserts value is Set<number> {}
const set: unknown = new Set<unknown>([2, "7"]);
assertNumberSet(set);
const copied: number[] = Array.from(set);
assert.sameValue(copied.length, 2);
assert.sameValue(typeof copied[1], "string");
assert.sameValue(String(copied[1] + 1), "71");
assert.sameValue(JSON.stringify(copied), '[2,"7"]');
