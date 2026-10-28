/*---
description: Explicit generic widening leaves a string in a numeric Map key through a forEach callback.
features: [ts-unsound-generic-widening, ts-map-set, ts-typeof-operator, ts-conversions, ts-functions, ts-generics, ts-template-literals]
---*/
// TypeScript admits the numeric container at an explicit unknown instantiation
// through method bivariance. The write breaks its type; node keeps the string.
function insert<T>(map: Map<T, number>, key: T): void {
  map.set(key, 70);
}
const map = new Map<number, number>([[2, 20]]);
insert<unknown>(map, "7");
const seen: string[] = [];
map.forEach((value, key, owner) => {
  assert.sameValue(owner, map);
  seen.push(`${typeof key}:${key + 1}:${value}`);
});
assert.compareArray(seen, ["number:3:20", "string:71:70"]);
