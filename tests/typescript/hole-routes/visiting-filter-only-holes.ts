/*---
description: "filter skips all slots of an all-hole array and returns an empty dense result."
features: [ts-hole-routes, ts-hole-route-visiting, ts-arrays]
---*/

// filter skips all slots of an all-hole array and returns an empty dense result. Route: captured closure. Node prints visiting-filter-only-holes:ok.
type V = number | undefined;
const items: V[] = [, ,];
let captured = items; function takeCaptured(): V[] { return captured; }
const target = takeCaptured();
const visits: number[] = [];
const result = target.filter((value, index) => { visits.push(index); return value !== undefined; });
const copy = result; const outputPresence: boolean[] = []; for (let i = 0; i < copy.length; i++) outputPresence.push(i in copy);
assert.compareArray(copy, []); assert.compareArray(outputPresence, []);
assert.compareArray(visits, []);
const presence: boolean[] = []; for (let i = 0; i < target.length; i++) presence.push(i in target);
assert.compareArray(presence, [false, false]);
console.log("visiting-filter-only-holes:ok");
