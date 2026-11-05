/*---
description: "reduceRight seeds from index 2, skips the middle hole and calls back at index 0. (control)"
features: [ts-hole-routes, ts-hole-route-visiting, ts-arrays]
---*/

// reduceRight seeds from index 2, skips the middle hole and calls back at index 0. Route: private class field. Node prints visiting-reduce-right-class:ok.
type V = number | undefined;
const items: V[] = []; const own: boolean[] = [];
const cells: readonly (readonly [boolean, V])[] = [[true, 1], [false, undefined], [true, 3]];
for (const cell of cells) { items.push(cell[1]); own.push(cell[0]); }
function localReduceRight(xs: V[], own: boolean[], visit: (total: V, value: V, i: number) => V): V { let started = false, acc: V = undefined; for (let i = xs.length - 1; i >= 0; i--) if (own[i]) { if (!started) { acc = xs[i]; started = true; } else acc = visit(acc, xs[i], i); } if (!started) throw new TypeError(); return acc; }
class Store { #data: V[]; constructor(xs: V[]) { this.#data = xs; } read(): V[] { return this.#data; } }
const target = new Store(items).read();
const visits: number[] = [];
const result = localReduceRight(target, own, (sum, value, index) => { visits.push(index); return (sum ?? 0) + (value ?? 0); });
assert.sameValue(result, 4); assert.compareArray(visits, [0]);
const presence: boolean[] = []; for (let i = 0; i < target.length; i++) presence.push(own[i]);
assert.compareArray(presence, [true, false, true]);
console.log("visiting-reduce-right-class:ok");
