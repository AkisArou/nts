/*---
description: "flatMap skips the middle hole and emits each present number twice in a dense result."
features: [ts-hole-routes, ts-hole-route-visiting, ts-arrays]
---*/

// flatMap skips the middle hole and emits each present number twice in a dense result. Route: interface array holder. Node prints visiting-flat-map-interface:ok.
type V = number | undefined;
const items: V[] = [1, , 3];
interface Carrier { data: V[]; }
const carrier: Carrier = { data: items }; const target = carrier.data;
const visits: number[] = [];
const result = target.flatMap((value, index) => { visits.push(index); return [value, value]; });
const copy = result; const outputPresence: boolean[] = []; for (let i = 0; i < copy.length; i++) outputPresence.push(i in copy);
assert.compareArray(copy, [1, 1, 3, 3]); assert.compareArray(outputPresence, [true, true, true, true]);
assert.compareArray(visits, [0, 2]);
const presence: boolean[] = []; for (let i = 0; i < target.length; i++) presence.push(i in target);
assert.compareArray(presence, [true, false, true]);
console.log("visiting-flat-map-interface:ok");
