/*---
description: "findIndex returns the stored undefined at index 1 before examining a later hole."
features: [ts-hole-routes, ts-hole-route-visiting, ts-arrays]
---*/

// findIndex returns the stored undefined at index 1 before examining a later hole. Route: captured closure. Node prints visiting-find-index-stored:ok.
type V = number | undefined;
const items: V[] = [1, undefined, , 3];
let captured = items; function takeCaptured(): V[] { return captured; }
const target = takeCaptured();
const visits: number[] = [];
const result = target.findIndex((value, index) => { visits.push(index); return value === undefined; });
assert.sameValue(result, 1); assert.compareArray(visits, [0, 1]);
const presence: boolean[] = []; for (let i = 0; i < target.length; i++) presence.push(i in target);
assert.compareArray(presence, [true, true, false, true]);
console.log("visiting-find-index-stored:ok");
