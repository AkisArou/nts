/*---
description: A lying predicate leaves a string in a claimed numeric Map key through get and has.
features: [ts-unsound-predicate, ts-map-set, ts-typeof-operator, ts-conversions, ts-iteration, ts-destructuring, ts-type-guards, ts-narrowing, ts-unknown]
---*/
// TypeScript trusts the lying predicate for this whole container,
// although a claimed numeric member is a string. Node preserves the actual string.
function isNumberKeys(value: unknown): value is Map<number, number> {
  return true;
}
const map: unknown = new Map<unknown, number>([["7", 70]]);
if (!isNumberKeys(map)) throw new Test262Error("predicate rejected the fixture");
// Recover the existing nominal-number key to exercise the narrow lookup API.
const [key] = map.keys();
assert.sameValue(typeof key, "string");
assert.sameValue(map.has(key), true);
assert.sameValue(map.get(key), 70);
assert.sameValue(map.has(7), false);
const identities = new Map<unknown, string>([["7", "string"], [7, "number"]]);
assert.sameValue(identities.get(key), "string");
