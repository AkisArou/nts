/*---
description: "Filling a length-created array replaces every hole with a value. (control)"
features: [ts-hole-routes, ts-hole-route-making, ts-arrays]
---*/

// Filling a length-created array replaces every hole with a value. Route: private class field. Node prints making-fill-entire-length:ok.
type V = number | string | undefined;
function localArrayLength(values: V[], present: boolean[], count: number): void { if (count < 0 || count % 1 !== 0 || count > 1000) throw new RangeError(); for (let i = 0; i < count; i++) { values.push(undefined); present.push(false); } }
function localFill(values: V[], present: boolean[], value: V, start: number, end: number): void { for (let i = start; i < end; i++) { values[i] = value; present[i] = true; } }
const items: V[] = []; const present: boolean[] = [];
localArrayLength(items, present, 3);
localFill(items, present, 0, 0, 3);
class HoleHolder { #stored: V[]; constructor(value: V[]) { this.#stored = value; } get(): V[] { return this.#stored; } }
const routed = new HoleHolder(items).get();
const actual: V[] = []; const observed: boolean[] = [];
for (let i = 0; i < routed.length; i++) { actual.push(present[i] ? routed[i] : undefined); observed.push(present[i]); }
assert.sameValue(routed.length, 3);
assert.compareArray(actual, [0, 0, 0]); assert.compareArray(observed, [true, true, true]);
console.log("making-fill-entire-length:ok");
