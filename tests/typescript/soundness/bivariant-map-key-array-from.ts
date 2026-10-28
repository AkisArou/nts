/*---
description: Array.from without a mapper copies a string key from a number-keyed Map.
features: [ts-unsound-bivariance, ts-map-set, ts-typeof-operator, ts-conversions, ts-iteration, ts-arrays]
---*/
// TypeScript's method bivariance permits a wider Map parameter to store a
// string key. Node preserves that string when the original number view reads it.
function insert(map: Map<unknown, number>): void {
  map.set("7", 70);
}
const map = new Map<number, number>([[2, 20]]);
insert(map);
const copied = Array.from(map);
assert.sameValue(copied.length, 2);
assert.sameValue(typeof copied[1][0], "string");
assert.sameValue(String(copied[1][0] + 1), "71");
assert.sameValue(JSON.stringify(copied), '[[2,20],["7",70]]');
