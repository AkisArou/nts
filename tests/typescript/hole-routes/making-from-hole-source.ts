/*---
description: "Array.from replaces source holes with owned undefined."
features: [ts-hole-routes, ts-hole-route-making, ts-arrays]
---*/

// Array.from replaces source holes with owned undefined. Route: constrained generic. Node prints making-from-hole-source:ok.
type V = number | string | undefined;
const items: V[] = Array.from(new Array<V>(2));
function throughArray<T>(value: T[]): T[] { return value; }
const routed = throughArray<V>(items);
const actual: V[] = []; const observed: boolean[] = [];
for (let i = 0; i < routed.length; i++) { actual.push(routed[i]); observed.push(i in routed); }
assert.sameValue(routed.length, 2);
assert.compareArray(actual, [undefined, undefined]); assert.compareArray(observed, [true, true]);
console.log("making-from-hole-source:ok");
