/*---
description: "Calling Array with a numeric length makes holes. (control)"
features: [ts-hole-routes, ts-hole-route-making, ts-arrays]
---*/

// Calling Array with a numeric length makes holes. Route: constrained generic. Node prints making-call-number-length-generic:ok.
type V = number | string | undefined;
function localArrayLength(values: V[], present: boolean[], count: number): void { if (count < 0 || count % 1 !== 0 || count > 1000) throw new RangeError(); for (let i = 0; i < count; i++) { values.push(undefined); present.push(false); } }
const items: V[] = []; const present: boolean[] = [];
localArrayLength(items, present, 4);
function throughArray<T>(value: T[]): T[] { return value; }
const routed = throughArray<V>(items);
const actual: V[] = []; const observed: boolean[] = [];
for (let i = 0; i < routed.length; i++) { actual.push(present[i] ? routed[i] : undefined); observed.push(present[i]); }
assert.sameValue(routed.length, 4);
assert.compareArray(actual, [undefined, undefined, undefined, undefined]); assert.compareArray(observed, [false, false, false, false]);
console.log("making-call-number-length-generic:ok");
