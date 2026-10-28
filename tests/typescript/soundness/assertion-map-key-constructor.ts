/*---
description: A lying assertion function leaves a string in a claimed numeric Map key through a copy constructor.
features: [ts-unsound-assertion, ts-map-set, ts-typeof-operator, ts-conversions, ts-iteration, ts-assertion-functions, ts-narrowing, ts-unknown, ts-destructuring]
---*/
// TypeScript trusts the lying assertion function for this whole container,
// although a claimed numeric member is a string. Node preserves the actual string.
function assertNumberKeys(value: unknown): asserts value is Map<number, number> {}
const map: unknown = new Map<unknown, number>([["7", 70]]);
assertNumberKeys(map);
const copy = new Map(map);
const [key] = copy.keys();
assert.sameValue(copy.size, 1);
assert.sameValue(typeof key, "string");
assert.sameValue(copy.has(key), true);
assert.sameValue(copy.get(key), 70);
assert.sameValue(copy.has(7), false);
const identities = new Map<unknown, string>([["7", "string"], [7, "number"]]);
assert.sameValue(identities.get(key), "string");
