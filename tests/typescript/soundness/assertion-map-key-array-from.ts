/*---
description: A lying assertion function leaves a string in a claimed numeric Map key through Array.from without a mapper.
features: [ts-unsound-assertion, ts-map-set, ts-typeof-operator, ts-conversions, ts-iteration, ts-arrays, ts-assertion-functions, ts-narrowing, ts-unknown]
---*/
// TypeScript trusts the lying assertion function for this whole container,
// although a claimed numeric member is a string. Node preserves the actual string.
function assertNumberKeys(value: unknown): asserts value is Map<number, number> {}
const map: unknown = new Map<unknown, number>([[2, 20], ["7", 70]]);
assertNumberKeys(map);
const copied = Array.from(map);
assert.sameValue(copied.length, 2);
assert.sameValue(typeof copied[1][0], "string");
assert.sameValue(String(copied[1][0] + 1), "71");
assert.sameValue(JSON.stringify(copied), '[[2,20],["7",70]]');
