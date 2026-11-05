/*---
description: "shift removes a leading hole, returns undefined and leaves both following values present."
features: [ts-hole-routes, ts-hole-route-changing, ts-arrays]
---*/

// shift removes a leading hole, returns undefined and leaves both following values present. Route: captured closure. Node prints changing-shift-hole:ok.
type V = number | undefined;
const items: V[] = [, 2, 3];
let captured: V[] = items; const reader = (): V[] => captured; const target = reader();
const result = target.shift();
const current: V[] = [], currentOwn: boolean[] = [];
for (let i = 0; i < target.length; i++) { current.push(target[i]); currentOwn.push(i in target); }
assert.compareArray(current, [2, 3]);
assert.compareArray(currentOwn, [true, true]);
assert.sameValue(result, undefined);
console.log("changing-shift-hole:ok");
