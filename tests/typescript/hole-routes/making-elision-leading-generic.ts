/*---
description: "A leading elision stays absent through a generic array helper."
features: [ts-hole-routes, ts-hole-route-making, ts-arrays]
---*/

// A leading elision stays absent through a generic array helper. Route: constrained generic. Node prints making-elision-leading-generic:ok.
type V = number | string | undefined;
const items: V[] = [, 2, 3];
function throughArray<T>(value: T[]): T[] { return value; }
const routed = throughArray<V>(items);
const actual: V[] = []; const observed: boolean[] = [];
for (let i = 0; i < routed.length; i++) { actual.push(routed[i]); observed.push(i in routed); }
assert.sameValue(routed.length, 3);
assert.compareArray(actual, [undefined, 2, 3]); assert.compareArray(observed, [false, true, true]);
console.log("making-elision-leading-generic:ok");
