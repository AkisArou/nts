/*---
description: "An elision between two values is absent although it reads undefined."
features: [ts-hole-routes, ts-hole-route-making, ts-arrays]
---*/

// An elision between two values is absent although it reads undefined. Route: interface field. Node prints making-elision-middle-interface:ok.
type V = number | string | undefined;
const items: V[] = [1, , 3];
interface HoleCarrier { items: V[]; }
const carrier: HoleCarrier = { items }; const routed = carrier.items;
const actual: V[] = []; const observed: boolean[] = [];
for (let i = 0; i < routed.length; i++) { actual.push(routed[i]); observed.push(i in routed); }
assert.sameValue(routed.length, 3);
assert.compareArray(actual, [1, undefined, 3]); assert.compareArray(observed, [true, false, true]);
console.log("making-elision-middle-interface:ok");
