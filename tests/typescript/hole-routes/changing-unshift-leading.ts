/*---
description: "unshift(0) inserts at index 0 and shifts the leading hole to index 1."
features: [ts-hole-routes, ts-hole-route-changing, ts-arrays]
---*/

// unshift(0) inserts at index 0 and shifts the leading hole to index 1. Route: interface field. Node prints changing-unshift-leading:ok.
type V = number | undefined;
const items: V[] = [, 2, 3];
interface Carrier { values: V[]; }
const holder: Carrier = { values: items }; const target = holder.values;
const result = target.unshift(0);
const current: V[] = [], currentOwn: boolean[] = [];
for (let i = 0; i < target.length; i++) { current.push(target[i]); currentOwn.push(i in target); }
assert.compareArray(current, [0, undefined, 2, 3]);
assert.compareArray(currentOwn, [true, false, true, true]);
assert.sameValue(result, 4);
console.log("changing-unshift-leading:ok");
