/*---
description: Map forEach passes a string to its number-typed key callback parameter.
features: [ts-unsound-bivariance, ts-map-set, ts-functions, ts-template-literals, ts-conversions, ts-typeof-operator]
---*/
// TypeScript's bivariant map methods allow a wider alias to insert a string
// key. Node passes that string unchanged to the narrow forEach callback.
function insert(map: Map<unknown, number>): void {
  map.set("7", 70);
}
const map = new Map<number, number>([[2, 20]]);
insert(map);
const seen: string[] = [];
map.forEach((value, key, owner) => {
  assert.sameValue(owner, map);
  seen.push(`${typeof key}:${key + 1}:${value}`);
});
assert.compareArray(seen, ["number:3:20", "string:71:70"]);
