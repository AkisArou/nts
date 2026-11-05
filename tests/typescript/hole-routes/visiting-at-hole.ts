/*---
description: "at(1) and at(-2) both read the middle hole as undefined while its index stays absent."
features: [ts-hole-routes, ts-hole-route-visiting, ts-arrays]
---*/

// at(1) and at(-2) both read the middle hole as undefined while its index stays absent. Route: private class field. Node prints visiting-at-hole:ok.
type V = number | undefined;
const items: V[] = [1, , 3];
class Store { #data: V[]; constructor(xs: V[]) { this.#data = xs; } read(): V[] { return this.#data; } }
const target = new Store(items).read();
const result = target.at(1);
assert.sameValue(result, undefined);
assert.sameValue(target.at(-2), undefined);
const presence: boolean[] = []; for (let i = 0; i < target.length; i++) presence.push(i in target);
assert.compareArray(presence, [true, false, true]);
console.log("visiting-at-hole:ok");
