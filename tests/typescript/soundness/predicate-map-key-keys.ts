/*---
description: A lying predicate leaves a string in a claimed numeric Map key through keys iteration.
features: [ts-unsound-predicate, ts-map-set, ts-typeof-operator, ts-conversions, ts-iteration, ts-type-guards, ts-narrowing, ts-unknown]
---*/
// TypeScript trusts the lying predicate for this whole container,
// although a claimed numeric member is a string. Node preserves the actual string.
function isNumberKeys(value: unknown): value is Map<number, number> {
  return true;
}
const map: unknown = new Map<unknown, number>([[2, 20], ["7", 70]]);
if (!isNumberKeys(map)) throw new Test262Error("predicate rejected the fixture");
const seen: string[] = [];
for (const key of map.keys()) {
  seen.push(typeof key + ":" + String(key + 1));
}
assert.compareArray(seen, ["number:3", "string:71"]);
