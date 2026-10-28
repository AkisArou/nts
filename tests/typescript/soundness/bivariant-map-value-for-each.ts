/*---
description: Map forEach passes a string to its number-typed value callback parameter.
features: [ts-unsound-bivariance, ts-map-set, ts-functions, ts-template-literals, ts-conversions, ts-typeof-operator]
---*/
// TypeScript allows the map to widen because its methods are bivariant.
// A string write then violates its narrow type; node passes the string onward.
function insert(map: Map<string, unknown>): void {
  map.set("value", "7");
}
const map = new Map<string, number>([["control", 2]]);
insert(map);
const seen: string[] = [];
map.forEach((value, key, owner) => {
  assert.sameValue(owner, map);
  seen.push(`${key}:${typeof value}:${value + 1}`);
});
assert.compareArray(seen, ["control:number:3", "value:string:71"]);
