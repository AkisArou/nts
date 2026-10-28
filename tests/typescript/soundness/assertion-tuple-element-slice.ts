/*---
description: A lying assertion function leaves a string in a claimed numeric tuple element through slice.
features: [ts-unsound-assertion, ts-arrays, ts-tuples, ts-typeof-operator, ts-conversions, ts-assertion-functions, ts-narrowing, ts-unknown, ts-unions]
---*/
// TypeScript trusts the lying assertion function for this whole container,
// although a claimed numeric member is a string. Node preserves the actual string.
function assertNumberTuple(value: unknown): asserts value is [number, boolean] {}
const values: unknown = ["7", true];
assertNumberTuple(values);
const copy = values.slice();
const value = copy[0];
if (typeof value === "boolean") throw new Test262Error("numeric slot became boolean");
assert.sameValue(typeof value, "string");
assert.sameValue(String(value + 1), "71");
assert.sameValue(JSON.stringify(copy), '["7",true]');
