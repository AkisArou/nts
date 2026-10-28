/*---
description: A lying predicate leaves a string in a claimed numeric Map key through Array.from's mapper.
features: [ts-unsound-predicate, ts-map-set, ts-typeof-operator, ts-conversions, ts-iteration, ts-arrays, ts-functions, ts-type-guards, ts-narrowing, ts-unknown]
---*/
// TypeScript trusts the lying predicate for this whole container,
// although a claimed numeric member is a string. Node preserves the actual string.
function isNumberKeys(value: unknown): value is Map<number, number> {
  return true;
}
const map: unknown = new Map<unknown, number>([[2, 20], ["7", 70]]);
if (!isNumberKeys(map)) throw new Test262Error("predicate rejected the fixture");
const copy = Array.from(map, (entry) => typeof entry[0] + ":" + String(entry[0] + 1));
assert.compareArray(copy, ["number:3", "string:71"]);
