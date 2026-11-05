/*---
description: "reduceRight seeds from index 2, skips the middle hole and calls back at index 0."
features: [ts-hole-routes, ts-hole-route-visiting, ts-arrays]
---*/

// reduceRight seeds from index 2, skips the middle hole and calls back at index 0. Route: private class field. Node prints visiting-reduce-right-class:ok.
type V = number | undefined;
const items: V[] = [1, , 3];
class Store { #data: V[]; constructor(xs: V[]) { this.#data = xs; } read(): V[] { return this.#data; } }
const target = new Store(items).read();
const visits: number[] = [];
const result = target.reduceRight((sum, value, index) => { visits.push(index); return (sum ?? 0) + (value ?? 0); });
assert.sameValue(result, 4); assert.compareArray(visits, [0]);
const presence: boolean[] = []; for (let i = 0; i < target.length; i++) presence.push(i in target);
assert.compareArray(presence, [true, false, true]);
console.log("visiting-reduce-right-class:ok");
