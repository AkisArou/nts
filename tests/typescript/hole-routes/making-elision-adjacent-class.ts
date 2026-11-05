/*---
description: "Adjacent elisions remain two distinct absent indexes."
features: [ts-hole-routes, ts-hole-route-making, ts-arrays]
---*/

// Adjacent elisions remain two distinct absent indexes. Route: private class field. Node prints making-elision-adjacent-class:ok.
type V = number | string | undefined;
const items: V[] = [1, , , 4];
class HoleHolder { #stored: V[]; constructor(value: V[]) { this.#stored = value; } get(): V[] { return this.#stored; } }
const routed = new HoleHolder(items).get();
const actual: V[] = []; const observed: boolean[] = [];
for (let i = 0; i < routed.length; i++) { actual.push(routed[i]); observed.push(i in routed); }
assert.sameValue(routed.length, 4);
assert.compareArray(actual, [1, undefined, undefined, 4]); assert.compareArray(observed, [true, false, false, true]);
console.log("making-elision-adjacent-class:ok");
