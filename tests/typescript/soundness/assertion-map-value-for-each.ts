/*---
description: A lying assertion function leaves a string in a claimed numeric Map value through a forEach callback.
features: [ts-unsound-assertion, ts-map-set, ts-typeof-operator, ts-conversions, ts-functions, ts-assertion-functions, ts-narrowing, ts-unknown, ts-template-literals]
---*/
// TypeScript trusts the lying assertion function for this whole container,
// although a claimed numeric member is a string. Node preserves the actual string.
function assertNumberValues(value: unknown): asserts value is Map<string, number> {}
const map: unknown = new Map<string, unknown>([["control", 2], ["value", "7"]]);
assertNumberValues(map);
const seen: string[] = [];
map.forEach((value, key, owner) => {
  assert.sameValue(owner, map);
  seen.push(`${key}:${typeof value}:${value + 1}`);
});
assert.compareArray(seen, ["control:number:3", "value:string:71"]);
