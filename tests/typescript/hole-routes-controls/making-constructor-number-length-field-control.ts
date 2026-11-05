/*---
description: "A numeric constructor length makes three absent slots. (control)"
features: [ts-hole-routes, ts-hole-route-making, ts-arrays]
---*/

// A numeric constructor length makes three absent slots. Route: private class field. Node prints making-constructor-number-length-field:ok.
type V = number | string | undefined;
function localArrayLength(values: V[], present: boolean[], count: number): void { if (count < 0 || count % 1 !== 0 || count > 1000) throw new RangeError(); for (let i = 0; i < count; i++) { values.push(undefined); present.push(false); } }
const items: V[] = []; const present: boolean[] = [];
localArrayLength(items, present, 3);
class HoleHolder { #stored: V[]; constructor(value: V[]) { this.#stored = value; } get(): V[] { return this.#stored; } }
const routed = new HoleHolder(items).get();
const actual: V[] = []; const observed: boolean[] = [];
for (let i = 0; i < routed.length; i++) { actual.push(present[i] ? routed[i] : undefined); observed.push(present[i]); }
assert.sameValue(routed.length, 3);
assert.compareArray(actual, [undefined, undefined, undefined]); assert.compareArray(observed, [false, false, false]);
console.log("making-constructor-number-length-field:ok");
