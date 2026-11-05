/*---
description: "Calling Array with a numeric length makes holes."
features: [ts-hole-routes, ts-hole-route-making, ts-arrays]
---*/

// Calling Array with a numeric length makes holes. Route: constrained generic. Node prints making-call-number-length-generic:ok.
type V = number | string | undefined;
const items: V[] = Array<V>(4);
function throughArray<T>(value: T[]): T[] { return value; }
const routed = throughArray<V>(items);
const actual: V[] = []; const observed: boolean[] = [];
for (let i = 0; i < routed.length; i++) { actual.push(routed[i]); observed.push(i in routed); }
assert.sameValue(routed.length, 4);
assert.compareArray(actual, [undefined, undefined, undefined, undefined]); assert.compareArray(observed, [false, false, false, false]);
console.log("making-call-number-length-generic:ok");
