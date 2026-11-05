/*---
description: "reverse moves the middle hole to its reversed position without filling it."
features: [ts-hole-routes, ts-hole-route-changing, ts-arrays]
---*/

// reverse moves the middle hole to its reversed position without filling it. Route: interface field. Node prints changing-reverse-middle:ok.
type V = number | undefined;
const items: V[] = [1, , 3, 4];
interface Carrier { values: V[]; }
const holder: Carrier = { values: items }; const target = holder.values;
const result = target.reverse();
const current: V[] = [], currentOwn: boolean[] = [];
for (let i = 0; i < target.length; i++) { current.push(target[i]); currentOwn.push(i in target); }
assert.compareArray(current, [4, 3, undefined, 1]);
assert.compareArray(currentOwn, [true, true, false, true]);
assert.sameValue(result, target);
console.log("changing-reverse-middle:ok");
