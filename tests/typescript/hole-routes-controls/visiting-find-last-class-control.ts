/*---
description: "findLast visits a middle hole as undefined while scanning in reverse order 2, 1, 0. (control)"
features: [ts-hole-routes, ts-hole-route-visiting, ts-arrays]
---*/

// findLast visits a middle hole as undefined while scanning in reverse order 2, 1, 0. Route: private class field. Node prints visiting-find-last-class:ok.
type V = number | undefined;
const items: V[] = []; const own: boolean[] = [];
const cells: readonly (readonly [boolean, V])[] = [[true, 1], [false, undefined], [true, 3]];
for (const cell of cells) { items.push(cell[1]); own.push(cell[0]); }
function localFindLast(xs: V[], own: boolean[], visit: (value: V, i: number) => boolean): V { for (let i = xs.length - 1; i >= 0; i--) if (visit(own[i] ? xs[i] : undefined, i)) return own[i] ? xs[i] : undefined; return undefined; }
class Store { #data: V[]; constructor(xs: V[]) { this.#data = xs; } read(): V[] { return this.#data; } }
const target = new Store(items).read();
const visits: number[] = [];
const result = localFindLast(target, own, (value, index) => { visits.push(index); return false; });
assert.sameValue(result, undefined); assert.compareArray(visits, [2, 1, 0]);
const presence: boolean[] = []; for (let i = 0; i < target.length; i++) presence.push(own[i]);
assert.compareArray(presence, [true, false, true]);
console.log("visiting-find-last-class:ok");
