/*---
description: A lying predicate leaves a string in a claimed numeric Map key through Array.from without a mapper.
features: [ts-unsound-predicate, ts-map-set, ts-typeof-operator, ts-conversions, ts-iteration, ts-arrays, ts-type-guards, ts-narrowing, ts-unknown]
---*/
// TypeScript trusts the lying predicate for this whole container,
// although a claimed numeric member is a string. Node preserves the actual string.
function isNumberKeys(value: unknown): value is Map<number, number> {
  return true;
}
const map: unknown = new Map<unknown, number>([[2, 20], ["7", 70]]);
if (!isNumberKeys(map)) throw new Test262Error("predicate rejected the fixture");
const copied = Array.from(map);
assert.sameValue(copied.length, 2);
assert.sameValue(typeof copied[1][0], "string");
assert.sameValue(String(copied[1][0] + 1), "71");
assert.sameValue(JSON.stringify(copied), '[[2,20],["7",70]]');
