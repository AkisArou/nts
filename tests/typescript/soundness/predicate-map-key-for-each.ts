/*---
description: A lying predicate leaves a string in a claimed numeric Map key through a forEach callback.
features: [ts-unsound-predicate, ts-map-set, ts-typeof-operator, ts-conversions, ts-functions, ts-type-guards, ts-narrowing, ts-unknown, ts-template-literals]
---*/
// TypeScript trusts the lying predicate for this whole container,
// although a claimed numeric member is a string. Node preserves the actual string.
function isNumberKeys(value: unknown): value is Map<number, number> {
  return true;
}
const map: unknown = new Map<unknown, number>([[2, 20], ["7", 70]]);
if (!isNumberKeys(map)) throw new Test262Error("predicate rejected the fixture");
const seen: string[] = [];
map.forEach((value, key, owner) => {
  assert.sameValue(owner, map);
  seen.push(`${typeof key}:${key + 1}:${value}`);
});
assert.compareArray(seen, ["number:3:20", "string:71:70"]);
