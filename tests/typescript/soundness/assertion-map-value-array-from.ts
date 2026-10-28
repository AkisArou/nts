/*---
description: A lying assertion function leaves a string in a claimed numeric Map value through Array.from without a mapper.
features: [ts-unsound-assertion, ts-map-set, ts-typeof-operator, ts-conversions, ts-iteration, ts-arrays, ts-assertion-functions, ts-narrowing, ts-unknown]
---*/
// TypeScript trusts the lying assertion function for this whole container,
// although a claimed numeric member is a string. Node preserves the actual string.
function assertNumberValues(value: unknown): asserts value is Map<string, number> {}
const map: unknown = new Map<string, unknown>([["control", 2], ["value", "7"]]);
assertNumberValues(map);
const copy = Array.from(map);
assert.sameValue(copy.length, 2);
assert.sameValue(typeof copy[1][1], "string");
assert.sameValue(JSON.stringify(copy), '[["control",2],["value","7"]]');
