/*---
description: "find visits indexes 0, 1 and 2, including the middle hole, before its predicate returns no match."
features: [ts-hole-routes, ts-hole-route-visiting, ts-arrays]
---*/

// find visits indexes 0, 1 and 2, including the middle hole, before its predicate returns no match. Route: private class field. Node prints visiting-find-class:ok.
type V = number | undefined;
const items: V[] = [1, , 3];
class Store { #data: V[]; constructor(xs: V[]) { this.#data = xs; } read(): V[] { return this.#data; } }
const target = new Store(items).read();
const visits: number[] = [];
const result = target.find((value, index) => { visits.push(index); return false; });
assert.sameValue(result, undefined); assert.compareArray(visits, [0, 1, 2]);
const presence: boolean[] = []; for (let i = 0; i < target.length; i++) presence.push(i in target);
assert.compareArray(presence, [true, false, true]);
console.log("visiting-find-class:ok");
