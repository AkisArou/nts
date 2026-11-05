/*---
description: "reverse preserves the middle hole at index 1 while swapping its two neighboring numbers."
features: [ts-hole-routes, ts-hole-route-changing, ts-arrays]
---*/

// reverse preserves the middle hole at index 1 while swapping its two neighboring numbers. Route: generic helper. Node prints changing-reverse-symmetric:ok.
type V = number | undefined;
const items: V[] = [1, , 3];
function relay<T>(xs: T[]): T[] { return xs; }
const target = relay<V>(items);
const result = target.reverse();
const current: V[] = [], currentOwn: boolean[] = [];
for (let i = 0; i < target.length; i++) { current.push(target[i]); currentOwn.push(i in target); }
assert.compareArray(current, [3, undefined, 1]);
assert.compareArray(currentOwn, [true, false, true]);
assert.sameValue(result, target);
console.log("changing-reverse-symmetric:ok");
