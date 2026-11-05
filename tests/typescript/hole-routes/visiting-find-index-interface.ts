/*---
description: "findIndex calls its predicate on the middle hole as undefined and returns index 1."
features: [ts-hole-routes, ts-hole-route-visiting, ts-arrays]
---*/

// findIndex calls its predicate on the middle hole as undefined and returns index 1. Route: interface array holder. Node prints visiting-find-index-interface:ok.
type V = number | undefined;
const items: V[] = [1, , 3];
interface Carrier { data: V[]; }
const carrier: Carrier = { data: items }; const target = carrier.data;
const visits: number[] = [];
const result = target.findIndex((value, index) => { visits.push(index); return value === undefined; });
assert.sameValue(result, 1); assert.compareArray(visits, [0, 1]);
const presence: boolean[] = []; for (let i = 0; i < target.length; i++) presence.push(i in target);
assert.compareArray(presence, [true, false, true]);
console.log("visiting-find-index-interface:ok");
