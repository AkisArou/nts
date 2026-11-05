/*---
description: "Writing past the end leaves intervening indexes absent."
features: [ts-hole-routes, ts-hole-route-making, ts-arrays]
---*/

// Writing past the end leaves intervening indexes absent. Route: captured closure. Node prints making-write-past-end-closure:ok.
type V = number | string | undefined;
const items: V[] = [1];
let captured: V[] = items; const readCaptured = (): V[] => captured;
const routed = readCaptured();
routed[4] = 5;
const actual: V[] = []; const observed: boolean[] = [];
for (let i = 0; i < routed.length; i++) { actual.push(routed[i]); observed.push(i in routed); }
assert.sameValue(routed.length, 5);
assert.compareArray(actual, [1, undefined, undefined, undefined, 5]); assert.compareArray(observed, [true, false, false, false, true]);
console.log("making-write-past-end-closure:ok");
