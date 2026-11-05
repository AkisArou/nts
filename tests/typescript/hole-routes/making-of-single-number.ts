/*---
description: "Array.of(3) stores one element, not three holes."
features: [ts-hole-routes, ts-hole-route-making, ts-arrays]
---*/

// Array.of(3) stores one element, not three holes. Route: captured closure. Node prints making-of-single-number:ok.
type V = number | string | undefined;
const items: V[] = Array.of<V>(3);
let captured: V[] = items; const readCaptured = (): V[] => captured;
const routed = readCaptured();
const actual: V[] = []; const observed: boolean[] = [];
for (let i = 0; i < routed.length; i++) { actual.push(routed[i]); observed.push(i in routed); }
assert.sameValue(routed.length, 1);
assert.compareArray(actual, [3]); assert.compareArray(observed, [true]);
console.log("making-of-single-number:ok");
