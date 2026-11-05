/*---
description: "A numeric constructor length makes three absent slots."
features: [ts-hole-routes, ts-hole-route-making, ts-arrays]
---*/

// A numeric constructor length makes three absent slots. Route: private class field. Node prints making-constructor-number-length-field:ok.
type V = number | string | undefined;
const items: V[] = new Array<V>(3);
class HoleHolder { #stored: V[]; constructor(value: V[]) { this.#stored = value; } get(): V[] { return this.#stored; } }
const routed = new HoleHolder(items).get();
const actual: V[] = []; const observed: boolean[] = [];
for (let i = 0; i < routed.length; i++) { actual.push(routed[i]); observed.push(i in routed); }
assert.sameValue(routed.length, 3);
assert.compareArray(actual, [undefined, undefined, undefined]); assert.compareArray(observed, [false, false, false]);
console.log("making-constructor-number-length-field:ok");
