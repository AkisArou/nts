/*---
description: "Writing undefined into an absent slot makes it present."
features: [ts-hole-routes, ts-hole-route-making, ts-arrays]
---*/

// Writing undefined into an absent slot makes it present. Route: interface field. Node prints making-write-undefined-into-hole:ok.
type V = number | string | undefined;
const items: V[] = [1, , 3];
interface HoleCarrier { items: V[]; }
const carrier: HoleCarrier = { items }; const routed = carrier.items;
routed[1] = undefined;
const actual: V[] = []; const observed: boolean[] = [];
for (let i = 0; i < routed.length; i++) { actual.push(routed[i]); observed.push(i in routed); }
assert.sameValue(routed.length, 3);
assert.compareArray(actual, [1, undefined, 3]); assert.compareArray(observed, [true, true, true]);
console.log("making-write-undefined-into-hole:ok");
