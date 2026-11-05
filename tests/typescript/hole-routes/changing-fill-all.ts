/*---
description: "fill(0) replaces both holes with present zero values and returns the original array."
features: [ts-hole-routes, ts-hole-route-changing, ts-arrays]
---*/

// fill(0) replaces both holes with present zero values and returns the original array. Route: generic helper. Node prints changing-fill-all:ok.
type V = number | undefined;
const items: V[] = [, ,];
function relay<T>(xs: T[]): T[] { return xs; }
const target = relay<V>(items);
const result = target.fill(0);
const current: V[] = [], currentOwn: boolean[] = [];
for (let i = 0; i < target.length; i++) { current.push(target[i]); currentOwn.push(i in target); }
assert.compareArray(current, [0, 0]);
assert.compareArray(currentOwn, [true, true]);
assert.sameValue(result, target);
console.log("changing-fill-all:ok");
