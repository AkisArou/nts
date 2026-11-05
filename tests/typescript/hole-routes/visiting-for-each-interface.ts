/*---
description: "forEach visits indexes 0 and 2 while skipping the absent middle index."
features: [ts-hole-routes, ts-hole-route-visiting, ts-arrays]
---*/

// forEach visits indexes 0 and 2 while skipping the absent middle index. Route: interface array holder. Node prints visiting-for-each-interface:ok.
type V = number | undefined;
const items: V[] = [1, , 3];
interface Carrier { data: V[]; }
const carrier: Carrier = { data: items }; const target = carrier.data;
const visits: number[] = [];
const result = target.forEach((value, index) => { visits.push(index); });
assert.sameValue(result, undefined);
assert.compareArray(visits, [0, 2]);
const presence: boolean[] = []; for (let i = 0; i < target.length; i++) presence.push(i in target);
assert.compareArray(presence, [true, false, true]);
console.log("visiting-for-each-interface:ok");
