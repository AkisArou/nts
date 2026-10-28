/*---
description: A lying assertion function leaves a string in a claimed numeric Map key through get and has.
features: [ts-unsound-assertion, ts-map-set, ts-typeof-operator, ts-conversions, ts-iteration, ts-destructuring, ts-assertion-functions, ts-narrowing, ts-unknown]
---*/
// TypeScript trusts the lying assertion function for this whole container,
// although a claimed numeric member is a string. Node preserves the actual string.
function assertNumberKeys(value: unknown): asserts value is Map<number, number> {}
const map: unknown = new Map<unknown, number>([["7", 70]]);
assertNumberKeys(map);
// Recover the existing nominal-number key to exercise the narrow lookup API.
const [key] = map.keys();
assert.sameValue(typeof key, "string");
assert.sameValue(map.has(key), true);
assert.sameValue(map.get(key), 70);
assert.sameValue(map.has(7), false);
const identities = new Map<unknown, string>([["7", "string"], [7, "number"]]);
assert.sameValue(identities.get(key), "string");
