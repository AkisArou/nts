/*---
description: "Filling a length-created array replaces every hole with a value."
features: [ts-hole-routes, ts-hole-route-making, ts-arrays]
---*/

// Filling a length-created array replaces every hole with a value. Route: private class field. Node prints making-fill-entire-length:ok.
type V = number | string | undefined;
const items: V[] = new Array<V>(3).fill(0);
class HoleHolder { #stored: V[]; constructor(value: V[]) { this.#stored = value; } get(): V[] { return this.#stored; } }
const routed = new HoleHolder(items).get();
const actual: V[] = []; const observed: boolean[] = [];
for (let i = 0; i < routed.length; i++) { actual.push(routed[i]); observed.push(i in routed); }
assert.sameValue(routed.length, 3);
assert.compareArray(actual, [0, 0, 0]); assert.compareArray(observed, [true, true, true]);
console.log("making-fill-entire-length:ok");
