/*---
description: Map keys yields the actual string stored through a wider parameter.
features: [ts-unsound-bivariance, ts-map-set, ts-iteration, ts-conversions, ts-typeof-operator]
---*/
// TypeScript accepts Map<number, number> as Map<unknown, number> because of
// method bivariance. Node's number-typed key iterator still yields the string.
function insert(map: Map<unknown, number>): void {
  map.set("7", 70);
}
const map = new Map<number, number>([[2, 20]]);
insert(map);
const seen: string[] = [];
for (const key of map.keys()) {
  seen.push(typeof key + ":" + String(key + 1));
}
assert.compareArray(seen, ["number:3", "string:71"]);
