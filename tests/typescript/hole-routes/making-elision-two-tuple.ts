/*---
description: "Two elisions create two holes and length two."
features: [ts-hole-routes, ts-hole-route-making, ts-arrays]
---*/

// Two elisions create two holes and length two. Route: readonly tuple rows. Node prints making-elision-two-tuple:ok.
type V = number | string | undefined;
const items: V[] = [, ,];
const rows: readonly [string, V[]][] = [["first", items]];
const routed = rows[0][1];
const actual: V[] = []; const observed: boolean[] = [];
for (let i = 0; i < routed.length; i++) { actual.push(routed[i]); observed.push(i in routed); }
assert.sameValue(routed.length, 2);
assert.compareArray(actual, [undefined, undefined]); assert.compareArray(observed, [false, false]);
console.log("making-elision-two-tuple:ok");
