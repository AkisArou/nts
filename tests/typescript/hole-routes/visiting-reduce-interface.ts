/*---
description: "reduce seeds from index 0, skips the hole at index 1, and calls back only at index 2."
features: [ts-hole-routes, ts-hole-route-visiting, ts-arrays]
---*/

// reduce seeds from index 0, skips the hole at index 1, and calls back only at index 2. Route: interface array holder. Node prints visiting-reduce-interface:ok.
type V = number | undefined;
const items: V[] = [1, , 3];
interface Carrier { data: V[]; }
const carrier: Carrier = { data: items }; const target = carrier.data;
const visits: number[] = [];
const result = target.reduce((sum, value, index) => { visits.push(index); return (sum ?? 0) + (value ?? 0); });
assert.sameValue(result, 4); assert.compareArray(visits, [2]);
const presence: boolean[] = []; for (let i = 0; i < target.length; i++) presence.push(i in target);
assert.compareArray(presence, [true, false, true]);
console.log("visiting-reduce-interface:ok");
