/*---
description: A lying predicate leaves a string in a claimed numeric Map value through Array.from without a mapper.
features: [ts-unsound-predicate, ts-map-set, ts-typeof-operator, ts-conversions, ts-iteration, ts-arrays, ts-type-guards, ts-narrowing, ts-unknown]
---*/
// TypeScript trusts the lying predicate for this whole container,
// although a claimed numeric member is a string. Node preserves the actual string.
function isNumberValues(value: unknown): value is Map<string, number> {
  return true;
}
const map: unknown = new Map<string, unknown>([["control", 2], ["value", "7"]]);
if (!isNumberValues(map)) throw new Test262Error("predicate rejected the fixture");
const copy = Array.from(map);
assert.sameValue(copy.length, 2);
assert.sameValue(typeof copy[1][1], "string");
assert.sameValue(JSON.stringify(copy), '[["control",2],["value","7"]]');
