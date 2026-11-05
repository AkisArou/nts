/*---
description: "fill(7, 1, 2) turns only the middle hole into a present number."
features: [ts-hole-routes, ts-hole-route-changing, ts-arrays]
---*/

// fill(7, 1, 2) turns only the middle hole into a present number. Route: interface field. Node prints changing-fill-middle:ok.
type V = number | undefined;
const items: V[] = [1, , 3];
interface Carrier { values: V[]; }
const holder: Carrier = { values: items }; const target = holder.values;
const result = target.fill(7, 1, 2);
const current: V[] = [], currentOwn: boolean[] = [];
for (let i = 0; i < target.length; i++) { current.push(target[i]); currentOwn.push(i in target); }
assert.compareArray(current, [1, 7, 3]);
assert.compareArray(currentOwn, [true, true, true]);
assert.sameValue(result, target);
console.log("changing-fill-middle:ok");
