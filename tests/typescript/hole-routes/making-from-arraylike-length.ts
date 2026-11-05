/*---
description: "Array.from on a length-only object creates owned undefined slots."
features: [ts-hole-routes, ts-hole-route-making, ts-arrays]
---*/

// Array.from on a length-only object creates owned undefined slots. Route: readonly tuple rows. Node prints making-from-arraylike-length:ok.
type V = unknown;
const items: V[] = Array.from({ length: 3 });
const rows: readonly [string, V[]][] = [["first", items]];
const routed = rows[0][1];
const actual: V[] = []; const observed: boolean[] = [];
for (let i = 0; i < routed.length; i++) { actual.push(routed[i]); observed.push(i in routed); }
assert.sameValue(routed.length, 3);
assert.compareArray(actual, [undefined, undefined, undefined]); assert.compareArray(observed, [true, true, true]);
console.log("making-from-arraylike-length:ok");
