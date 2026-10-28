/*---
description: A lying predicate leaves a string in a claimed numeric Map key through a spread copy.
features: [ts-unsound-predicate, ts-map-set, ts-typeof-operator, ts-conversions, ts-iteration, ts-spread, ts-type-guards, ts-narrowing, ts-unknown, ts-arrays]
---*/
// TypeScript trusts the lying predicate for this whole container,
// although a claimed numeric member is a string. Node preserves the actual string.
function isNumberKeys(value: unknown): value is Map<number, number> {
  return true;
}
const map: unknown = new Map<unknown, number>([[2, 20], ["7", 70]]);
if (!isNumberKeys(map)) throw new Test262Error("predicate rejected the fixture");
const copy = [...map];
assert.sameValue(copy.length, 2);
assert.sameValue(typeof copy[1][0], "string");
assert.sameValue(JSON.stringify(copy), '[[2,20],["7",70]]');
