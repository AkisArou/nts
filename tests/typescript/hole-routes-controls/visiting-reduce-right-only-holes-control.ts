/*---
description: "reduceRight over three holes without an initial value throws TypeError without a callback. (control)"
features: [ts-hole-routes, ts-hole-route-visiting, ts-arrays]
---*/

// reduceRight over three holes without an initial value throws TypeError without a callback. Route: generic helper. Node prints visiting-reduce-right-only-holes:ok.
type V = number | undefined;
const items: V[] = []; const own: boolean[] = [];
const cells: readonly (readonly [boolean, V])[] = [[false, undefined], [false, undefined], [false, undefined]];
for (const cell of cells) { items.push(cell[1]); own.push(cell[0]); }
function localReduceRight(xs: V[], own: boolean[], visit: (total: V, value: V, i: number) => V): V { let started = false, acc: V = undefined; for (let i = xs.length - 1; i >= 0; i--) if (own[i]) { if (!started) { acc = xs[i]; started = true; } else acc = visit(acc, xs[i], i); } if (!started) throw new TypeError(); return acc; }
function take<T>(xs: T[]): T[] { return xs; }
const target = take<V>(items);
const visits: number[] = [];
assert.throws(TypeError, () => localReduceRight(target, own, (sum, value, index) => { visits.push(index); return (sum ?? 0) + (value ?? 0); }));
assert.compareArray(visits, []);
const presence: boolean[] = []; for (let i = 0; i < target.length; i++) presence.push(own[i]);
assert.compareArray(presence, [false, false, false]);
console.log("visiting-reduce-right-only-holes:ok");
