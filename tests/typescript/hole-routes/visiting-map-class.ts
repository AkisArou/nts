/*---
description: "map visits indexes 0 and 2 while preserving the absent middle index in its result."
features: [ts-hole-routes, ts-hole-route-visiting, ts-arrays]
---*/

// map visits indexes 0 and 2 while preserving the absent middle index in its result. Route: private class field. Node prints visiting-map-class:ok.
type V = number | undefined;
const items: V[] = [1, , 3];
class Store { #data: V[]; constructor(xs: V[]) { this.#data = xs; } read(): V[] { return this.#data; } }
const target = new Store(items).read();
const visits: number[] = [];
const result = target.map((value, index) => { visits.push(index); return value === undefined ? 0 : value * 10; });
const copy = result; const outputPresence: boolean[] = []; for (let i = 0; i < copy.length; i++) outputPresence.push(i in copy);
const actual: V[] = []; for (let i = 0; i < copy.length; i++) actual.push(copy[i]);
assert.compareArray(actual, [10, undefined, 30]); assert.compareArray(outputPresence, [true, false, true]);
assert.compareArray(visits, [0, 2]);
const presence: boolean[] = []; for (let i = 0; i < target.length; i++) presence.push(i in target);
assert.compareArray(presence, [true, false, true]);
console.log("visiting-map-class:ok");
