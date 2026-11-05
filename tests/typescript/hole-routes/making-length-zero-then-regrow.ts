/*---
description: "Setting length to zero clears all former indexes before growth."
features: [ts-hole-routes, ts-hole-route-making, ts-arrays]
---*/

// Setting length to zero clears all former indexes before growth. Route: captured closure. Node prints making-length-zero-then-regrow:ok.
type V = number | string | undefined;
const items: V[] = [1, , 3];
let captured: V[] = items; const readCaptured = (): V[] => captured;
const routed = readCaptured();
routed.length = 0; routed.length = 2;
const actual: V[] = []; const observed: boolean[] = [];
for (let i = 0; i < routed.length; i++) { actual.push(routed[i]); observed.push(i in routed); }
assert.sameValue(routed.length, 2);
assert.compareArray(actual, [undefined, undefined]); assert.compareArray(observed, [false, false]);
console.log("making-length-zero-then-regrow:ok");
