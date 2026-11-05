/*---
description: "findLast visits a middle hole as undefined while scanning in reverse order 2, 1, 0."
features: [ts-hole-routes, ts-hole-route-visiting, ts-arrays]
---*/

// findLast visits a middle hole as undefined while scanning in reverse order 2, 1, 0. Route: private class field. Node prints visiting-find-last-class:ok.
type V = number | undefined;
const items: V[] = [1, , 3];
class Store { #data: V[]; constructor(xs: V[]) { this.#data = xs; } read(): V[] { return this.#data; } }
const target = new Store(items).read();
const visits: number[] = [];
const result = target.findLast((value, index) => { visits.push(index); return false; });
assert.sameValue(result, undefined); assert.compareArray(visits, [2, 1, 0]);
const presence: boolean[] = []; for (let i = 0; i < target.length; i++) presence.push(i in target);
assert.compareArray(presence, [true, false, true]);
console.log("visiting-find-last-class:ok");
