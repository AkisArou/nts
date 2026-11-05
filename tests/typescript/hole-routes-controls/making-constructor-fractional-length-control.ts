/*---
description: "A fractional array constructor length throws RangeError. (control)"
features: [ts-hole-routes, ts-hole-route-making, ts-arrays]
---*/

// A fractional array constructor length throws RangeError. Route: interface field. Node prints making-constructor-fractional-length:ok.
type V = number | string | undefined;
function localArrayLength(values: V[], present: boolean[], count: number): void { if (count < 0 || count % 1 !== 0 || count > 1000) throw new RangeError(); for (let i = 0; i < count; i++) { values.push(undefined); present.push(false); } }
const items: V[] = []; const present: boolean[] = [];
interface HoleCarrier { items: V[]; }
const carrier: HoleCarrier = { items }; const routed = carrier.items;
assert.throws(RangeError, () => localArrayLength(items, present, 1.5));
const actual: V[] = []; const observed: boolean[] = [];
for (let i = 0; i < routed.length; i++) { actual.push(present[i] ? routed[i] : undefined); observed.push(present[i]); }
assert.sameValue(routed.length, 0);
assert.compareArray(actual, []); assert.compareArray(observed, []);
console.log("making-constructor-fractional-length:ok");
