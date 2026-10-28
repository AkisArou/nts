/*---
description: A lying predicate leaves a string in a claimed numeric Map value through a forEach callback.
features: [ts-unsound-predicate, ts-map-set, ts-typeof-operator, ts-conversions, ts-functions, ts-type-guards, ts-narrowing, ts-unknown, ts-template-literals]
---*/
// TypeScript trusts the lying predicate for this whole container,
// although a claimed numeric member is a string. Node preserves the actual string.
function isNumberValues(value: unknown): value is Map<string, number> {
  return true;
}
const map: unknown = new Map<string, unknown>([["control", 2], ["value", "7"]]);
if (!isNumberValues(map)) throw new Test262Error("predicate rejected the fixture");
const seen: string[] = [];
map.forEach((value, key, owner) => {
  assert.sameValue(owner, map);
  seen.push(`${key}:${typeof value}:${value + 1}`);
});
assert.compareArray(seen, ["control:number:3", "value:string:71"]);
