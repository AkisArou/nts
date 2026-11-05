/*---
description: "truncating length to zero then regrowing to two leaves two holes and loses previous values."
features: [ts-hole-routes, ts-hole-route-changing, ts-arrays]
---*/

// truncating length to zero then regrowing to two leaves two holes and loses previous values. Route: captured closure. Node prints changing-length-clear-grow:ok.
type V = number | undefined;
const items: V[] = [1, , 3];
let captured: V[] = items; const reader = (): V[] => captured; const target = reader();
target.length = 0; target.length = 2;
const current: V[] = [], currentOwn: boolean[] = [];
for (let i = 0; i < target.length; i++) { current.push(target[i]); currentOwn.push(i in target); }
assert.compareArray(current, [undefined, undefined]);
assert.compareArray(currentOwn, [false, false]);
console.log("changing-length-clear-grow:ok");
