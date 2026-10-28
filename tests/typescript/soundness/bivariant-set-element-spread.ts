/*---
description: Spreading a number-typed Set copies its actual string element.
features: [ts-unsound-bivariance, ts-map-set, ts-arrays, ts-iteration, ts-spread, ts-typeof-operator]
---*/
// TypeScript's method bivariance lets a wider Set parameter add a string into
// number-typed storage. Node copies the string unchanged when spreading it.
function insert(set: Set<unknown>): void {
  set.add("7");
}
const set = new Set<number>([2]);
insert(set);
const copy = [...set];
assert.sameValue(copy.length, 2);
assert.sameValue(typeof copy[1], "string");
assert.sameValue(JSON.stringify(copy), '[2,"7"]');
