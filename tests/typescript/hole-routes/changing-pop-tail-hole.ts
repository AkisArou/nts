/*---
description: "pop removes a trailing hole and returns undefined while preserving the first element."
features: [ts-hole-routes, ts-hole-route-changing, ts-arrays]
---*/

// pop removes a trailing hole and returns undefined while preserving the first element. Route: captured closure. Node prints changing-pop-tail-hole:ok.
type V = number | undefined;
const items: V[] = [1, , ];
let captured: V[] = items; const reader = (): V[] => captured; const target = reader();
const result = target.pop();
const current: V[] = [], currentOwn: boolean[] = [];
for (let i = 0; i < target.length; i++) { current.push(target[i]); currentOwn.push(i in target); }
assert.compareArray(current, [1]);
assert.compareArray(currentOwn, [true]);
assert.sameValue(result, undefined);
console.log("changing-pop-tail-hole:ok");
