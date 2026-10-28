/*---
description: Array.from's map function receives a string Map key despite its number type.
features: [ts-unsound-bivariance, ts-map-set, ts-arrays, ts-iteration, ts-functions, ts-conversions, ts-typeof-operator]
---*/
// TypeScript allows the wider map parameter by method bivariance. Node hands
// the inserted string to Array.from's number-typed mapping callback unchanged.
function insert(map: Map<unknown, number>): void {
  map.set("7", 70);
}
const map = new Map<number, number>([[2, 20]]);
insert(map);
const copy = Array.from(map, (entry) => typeof entry[0] + ":" + String(entry[0] + 1));
assert.compareArray(copy, ["number:3", "string:71"]);
