/*---
description: A lying assertion function leaves a string in a claimed numeric Map key through a spread copy.
features: [ts-unsound-assertion, ts-map-set, ts-typeof-operator, ts-conversions, ts-iteration, ts-spread, ts-assertion-functions, ts-narrowing, ts-unknown, ts-arrays]
---*/
// TypeScript trusts the lying assertion function for this whole container,
// although a claimed numeric member is a string. Node preserves the actual string.
function assertNumberKeys(value: unknown): asserts value is Map<number, number> {}
const map: unknown = new Map<unknown, number>([[2, 20], ["7", 70]]);
assertNumberKeys(map);
const copy = [...map];
assert.sameValue(copy.length, 2);
assert.sameValue(typeof copy[1][0], "string");
assert.sameValue(JSON.stringify(copy), '[[2,20],["7",70]]');
