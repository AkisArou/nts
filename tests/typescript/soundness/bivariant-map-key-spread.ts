/*---
description: Spreading a number-keyed Map copies its actual string key.
features: [ts-unsound-bivariance, ts-map-set, ts-arrays, ts-iteration, ts-spread, ts-typeof-operator]
---*/
// TypeScript's method bivariance lets the wider parameter insert a string key.
// Node copies that string into the spread result without converting it.
function insert(map: Map<unknown, number>): void {
  map.set("7", 70);
}
const map = new Map<number, number>([[2, 20]]);
insert(map);
const copy = [...map];
assert.sameValue(copy.length, 2);
assert.sameValue(typeof copy[1][0], "string");
assert.sameValue(JSON.stringify(copy), '[[2,20],["7",70]]');
