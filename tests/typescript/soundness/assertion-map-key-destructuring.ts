/*---
description: A lying assertion function leaves a string in a claimed numeric Map key through destructuring.
features: [ts-unsound-assertion, ts-map-set, ts-typeof-operator, ts-conversions, ts-iteration, ts-destructuring, ts-assertion-functions, ts-narrowing, ts-unknown]
---*/
// TypeScript trusts the lying assertion function for this whole container,
// although a claimed numeric member is a string. Node preserves the actual string.
function assertNumberKeys(value: unknown): asserts value is Map<number, number> {}
const map: unknown = new Map<unknown, number>([["7", 70]]);
assertNumberKeys(map);
const [[key, value]] = map;
assert.sameValue(typeof key, "string");
assert.sameValue(String(key + 1), "71");
assert.sameValue(value, 70);
