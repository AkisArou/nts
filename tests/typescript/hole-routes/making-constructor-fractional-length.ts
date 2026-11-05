/*---
description: "A fractional array constructor length throws RangeError."
features: [ts-hole-routes, ts-hole-route-making, ts-arrays]
---*/

// A fractional array constructor length throws RangeError. Route: interface field. Node prints making-constructor-fractional-length:ok.
type V = number | string | undefined;
const items: V[] = [];
interface HoleCarrier { items: V[]; }
const carrier: HoleCarrier = { items }; const routed = carrier.items;
assert.throws(RangeError, () => Array<V>(1.5));
const actual: V[] = []; const observed: boolean[] = [];
for (let i = 0; i < routed.length; i++) { actual.push(routed[i]); observed.push(i in routed); }
assert.sameValue(routed.length, 0);
assert.compareArray(actual, []); assert.compareArray(observed, []);
console.log("making-constructor-fractional-length:ok");
