/*---
description: Array.from without a map function copies a Map's string value under its number type.
features: [ts-unsound-bivariance, ts-map-set, ts-arrays, ts-iteration, ts-typeof-operator]
---*/
// TypeScript's method bivariance permits the wider parameter's string write.
// Node copies that string into Array.from's number-typed entry array.
function insert(map: Map<string, unknown>): void {
  map.set("value", "7");
}
const map = new Map<string, number>([["control", 2]]);
insert(map);
const copy = Array.from(map);
assert.sameValue(copy.length, 2);
assert.sameValue(typeof copy[1][1], "string");
assert.sameValue(JSON.stringify(copy), '[["control",2],["value","7"]]');
