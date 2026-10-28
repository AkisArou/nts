/*---
description: A lying predicate leaves a string in a claimed numeric Map key through a copy constructor.
features: [ts-unsound-predicate, ts-map-set, ts-typeof-operator, ts-conversions, ts-iteration, ts-type-guards, ts-narrowing, ts-unknown, ts-destructuring]
---*/
// TypeScript trusts the lying predicate for this whole container,
// although a claimed numeric member is a string. Node preserves the actual string.
function isNumberKeys(value: unknown): value is Map<number, number> {
  return true;
}
const map: unknown = new Map<unknown, number>([["7", 70]]);
if (!isNumberKeys(map)) throw new Test262Error("predicate rejected the fixture");
const copy = new Map(map);
const [key] = copy.keys();
assert.sameValue(copy.size, 1);
assert.sameValue(typeof key, "string");
assert.sameValue(copy.has(key), true);
assert.sameValue(copy.get(key), 70);
assert.sameValue(copy.has(7), false);
const identities = new Map<unknown, string>([["7", "string"], [7, "number"]]);
assert.sameValue(identities.get(key), "string");
