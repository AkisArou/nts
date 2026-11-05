/*---
description: "Assigning fractional length throws and preserves holes."
features: [ts-hole-routes, ts-hole-route-making, ts-arrays]
---*/

// Assigning fractional length throws and preserves holes. Route: interface field. Node prints making-length-invalid-fraction:ok.
type V = number | string | undefined;
const items: V[] = [1, , 3];
interface HoleCarrier { items: V[]; }
const carrier: HoleCarrier = { items }; const routed = carrier.items;
assert.throws(RangeError, () => { routed.length = 1.5; });
const actual: V[] = []; const observed: boolean[] = [];
for (let i = 0; i < routed.length; i++) { actual.push(routed[i]); observed.push(i in routed); }
assert.sameValue(routed.length, 3);
assert.compareArray(actual, [1, undefined, 3]); assert.compareArray(observed, [true, false, true]);
console.log("making-length-invalid-fraction:ok");
