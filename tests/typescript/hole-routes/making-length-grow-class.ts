/*---
description: "Growing length appends absent slots rather than owned undefined."
features: [ts-hole-routes, ts-hole-route-making, ts-arrays]
---*/

// Growing length appends absent slots rather than owned undefined. Route: private class field. Node prints making-length-grow-class:ok.
type V = number | string | undefined;
const items: V[] = [1, 2];
class HoleHolder { #stored: V[]; constructor(value: V[]) { this.#stored = value; } get(): V[] { return this.#stored; } }
const routed = new HoleHolder(items).get();
routed.length = 5;
const actual: V[] = []; const observed: boolean[] = [];
for (let i = 0; i < routed.length; i++) { actual.push(routed[i]); observed.push(i in routed); }
assert.sameValue(routed.length, 5);
assert.compareArray(actual, [1, 2, undefined, undefined, undefined]); assert.compareArray(observed, [true, true, false, false, false]);
console.log("making-length-grow-class:ok");
