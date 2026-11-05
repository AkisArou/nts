/*---
description: "A trailing comma after an elision preserves that one hole."
features: [ts-hole-routes, ts-hole-route-making, ts-arrays]
---*/

// A trailing comma after an elision preserves that one hole. Route: captured closure. Node prints making-elision-trailing-hole-closure:ok.
type V = number | string | undefined;
const items: V[] = [1, , ];
let captured: V[] = items; const readCaptured = (): V[] => captured;
const routed = readCaptured();
const actual: V[] = []; const observed: boolean[] = [];
for (let i = 0; i < routed.length; i++) { actual.push(routed[i]); observed.push(i in routed); }
assert.sameValue(routed.length, 2);
assert.compareArray(actual, [1, undefined]); assert.compareArray(observed, [true, false]);
console.log("making-elision-trailing-hole-closure:ok");
