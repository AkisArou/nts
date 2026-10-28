/*---
description: A lying assertion function leaves a string in a claimed numeric tuple element through filter.
features: [ts-unsound-assertion, ts-arrays, ts-tuples, ts-typeof-operator, ts-conversions, ts-functions, ts-assertion-functions, ts-narrowing, ts-unknown, ts-unions]
---*/
// TypeScript trusts the lying assertion function for this whole container,
// although a claimed numeric member is a string. Node preserves the actual string.
function assertNumberTuple(value: unknown): asserts value is [number, boolean] {}
const values: unknown = ["7", true];
assertNumberTuple(values);
const kept = values.filter((value: number | boolean): boolean => typeof value !== "boolean");
assert.sameValue(kept.length, 1);
const value = kept[0];
if (typeof value === "boolean") throw new Test262Error("filter kept the marker");
assert.sameValue(typeof value, "string");
assert.sameValue(String(value + 1), "71");
