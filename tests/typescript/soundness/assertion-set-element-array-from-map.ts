/*---
description: A lying assertion function leaves a string in a claimed numeric Set element through Array.from's mapper.
features: [ts-unsound-assertion, ts-map-set, ts-typeof-operator, ts-conversions, ts-iteration, ts-arrays, ts-functions, ts-assertion-functions, ts-narrowing, ts-unknown]
---*/
// TypeScript trusts the lying assertion function for this whole container,
// although a claimed numeric member is a string. Node preserves the actual string.
function assertNumberSet(value: unknown): asserts value is Set<number> {}
const set: unknown = new Set<unknown>([2, "7"]);
assertNumberSet(set);
const seen = Array.from(set, (value: number) => typeof value + ":" + String(value + 1));
assert.compareArray(seen, ["number:3", "string:71"]);
