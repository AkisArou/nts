/*---
description: Explicit generic widening leaves a string in a numeric Map value through a forEach callback.
features: [ts-unsound-generic-widening, ts-map-set, ts-typeof-operator, ts-conversions, ts-functions, ts-generics, ts-template-literals]
---*/
// TypeScript admits the numeric container at an explicit unknown instantiation
// through method bivariance. The write breaks its type; node keeps the string.
function insert<T>(map: Map<string, T>, value: T): void {
  map.set("value", value);
}
const map = new Map<string, number>([["control", 2]]);
insert<unknown>(map, "7");
const seen: string[] = [];
map.forEach((value, key, owner) => {
  assert.sameValue(owner, map);
  seen.push(`${key}:${typeof value}:${value + 1}`);
});
assert.compareArray(seen, ["control:number:3", "value:string:71"]);
