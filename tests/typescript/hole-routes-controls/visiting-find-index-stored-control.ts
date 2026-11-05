/*---
description: "findIndex returns the stored undefined at index 1 before examining a later hole. (control)"
features: [ts-hole-routes, ts-hole-route-visiting, ts-arrays]
---*/

// findIndex returns the stored undefined at index 1 before examining a later hole. Route: captured closure. Node prints visiting-find-index-stored:ok.
type V = number | undefined;
const items: V[] = []; const own: boolean[] = [];
const cells: readonly (readonly [boolean, V])[] = [[true, 1], [true, undefined], [false, undefined], [true, 3]];
for (const cell of cells) { items.push(cell[1]); own.push(cell[0]); }
function localFindIndex(xs: V[], own: boolean[], visit: (value: V, i: number) => boolean): number { for (let i = 0; i < xs.length; i++) if (visit(own[i] ? xs[i] : undefined, i)) return i; return -1; }
let captured = items; function takeCaptured(): V[] { return captured; }
const target = takeCaptured();
const visits: number[] = [];
const result = localFindIndex(target, own, (value, index) => { visits.push(index); return value === undefined; });
assert.sameValue(result, 1); assert.compareArray(visits, [0, 1]);
const presence: boolean[] = []; for (let i = 0; i < target.length; i++) presence.push(own[i]);
assert.compareArray(presence, [true, true, false, true]);
console.log("visiting-find-index-stored:ok");
