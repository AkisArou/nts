/*---
description: A lying assertion function leaves a string in a claimed numeric Map value through a spread copy.
features: [ts-unsound-assertion, ts-map-set, ts-typeof-operator, ts-conversions, ts-iteration, ts-spread, ts-assertion-functions, ts-narrowing, ts-unknown, ts-arrays]
---*/
// TypeScript trusts the lying assertion function for this whole container,
// although a claimed numeric member is a string. Node preserves the actual string.
function assertNumberValues(value: unknown): asserts value is Map<string, number> {}
const map: unknown = new Map<string, unknown>([["control", 2], ["value", "7"]]);
assertNumberValues(map);
const copied = [...map];
assert.sameValue(copied.length, 2);
assert.sameValue(typeof copied[1][1], "string");
assert.sameValue(String(copied[1][1] + 1), "71");
assert.sameValue(JSON.stringify(copied), '[["control",2],["value","7"]]');
