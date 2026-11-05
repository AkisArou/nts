/*---
description: "unshift(0) shifts a stored undefined and a distinct hole without merging their presence."
features: [ts-hole-routes, ts-hole-route-changing, ts-arrays]
---*/

// unshift(0) shifts a stored undefined and a distinct hole without merging their presence. Route: generic helper. Node prints changing-unshift-stored:ok.
type V = number | undefined;
const items: V[] = [undefined, , 3];
function relay<T>(xs: T[]): T[] { return xs; }
const target = relay<V>(items);
const result = target.unshift(0);
const current: V[] = [], currentOwn: boolean[] = [];
for (let i = 0; i < target.length; i++) { current.push(target[i]); currentOwn.push(i in target); }
assert.compareArray(current, [0, undefined, undefined, 3]);
assert.compareArray(currentOwn, [true, true, false, true]);
assert.sameValue(result, 4);
console.log("changing-unshift-stored:ok");
