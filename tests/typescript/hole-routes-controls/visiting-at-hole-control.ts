/*---
description: "at(1) and at(-2) both read the middle hole as undefined while its index stays absent. (control)"
features: [ts-hole-routes, ts-hole-route-visiting, ts-arrays]
---*/

// at(1) and at(-2) both read the middle hole as undefined while its index stays absent. Route: private class field. Node prints visiting-at-hole:ok.
type V = number | undefined;
const items: V[] = []; const own: boolean[] = [];
const cells: readonly (readonly [boolean, V])[] = [[true, 1], [false, undefined], [true, 3]];
for (const cell of cells) { items.push(cell[1]); own.push(cell[0]); }
function localAt(xs: V[], own: boolean[], index: number): V { const i = index < 0 ? xs.length + index : index; return i >= 0 && i < xs.length && own[i] ? xs[i] : undefined; }
class Store { #data: V[]; constructor(xs: V[]) { this.#data = xs; } read(): V[] { return this.#data; } }
const target = new Store(items).read();
const result = localAt(target, own, 1);
assert.sameValue(result, undefined);
assert.sameValue(localAt(target, own, -2), undefined);
const presence: boolean[] = []; for (let i = 0; i < target.length; i++) presence.push(own[i]);
assert.compareArray(presence, [true, false, true]);
console.log("visiting-at-hole:ok");
