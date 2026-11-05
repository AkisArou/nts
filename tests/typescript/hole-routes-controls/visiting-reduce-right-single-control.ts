/*---
description: "reduceRight over one present value returns 5 without invoking the callback. (control)"
features: [ts-hole-routes, ts-hole-route-visiting, ts-arrays]
---*/

// reduceRight over one present value returns 5 without invoking the callback. Route: captured closure. Node prints visiting-reduce-right-single:ok.
type V = number | undefined;
const items: V[] = []; const own: boolean[] = [];
const cells: readonly (readonly [boolean, V])[] = [[false, undefined], [true, 5], [false, undefined]];
for (const cell of cells) { items.push(cell[1]); own.push(cell[0]); }
function localReduceRight(xs: V[], own: boolean[], visit: (total: V, value: V, i: number) => V): V { let started = false, acc: V = undefined; for (let i = xs.length - 1; i >= 0; i--) if (own[i]) { if (!started) { acc = xs[i]; started = true; } else acc = visit(acc, xs[i], i); } if (!started) throw new TypeError(); return acc; }
let captured = items; function takeCaptured(): V[] { return captured; }
const target = takeCaptured();
const visits: number[] = [];
const result = localReduceRight(target, own, (sum, value, index) => { visits.push(index); return (sum ?? 0) + (value ?? 0); });
assert.sameValue(result, 5); assert.compareArray(visits, []);
const presence: boolean[] = []; for (let i = 0; i < target.length; i++) presence.push(own[i]);
assert.compareArray(presence, [false, true, false]);
console.log("visiting-reduce-right-single:ok");
