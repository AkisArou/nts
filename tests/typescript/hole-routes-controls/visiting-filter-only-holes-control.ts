/*---
description: "filter skips all slots of an all-hole array and returns an empty dense result. (control)"
features: [ts-hole-routes, ts-hole-route-visiting, ts-arrays]
---*/

// filter skips all slots of an all-hole array and returns an empty dense result. Route: captured closure. Node prints visiting-filter-only-holes:ok.
type V = number | undefined;
const items: V[] = []; const own: boolean[] = [];
const cells: readonly (readonly [boolean, V])[] = [[false, undefined], [false, undefined]];
for (const cell of cells) { items.push(cell[1]); own.push(cell[0]); }
function localFilter(xs: V[], own: boolean[], visit: (value: V, i: number) => boolean): { values: V[]; present: boolean[] } { const values: V[] = []; const present: boolean[] = []; for (let i = 0; i < xs.length; i++) if (own[i] && visit(xs[i], i)) { values.push(xs[i]); present.push(true); } return { values, present }; }
let captured = items; function takeCaptured(): V[] { return captured; }
const target = takeCaptured();
const visits: number[] = [];
const result = localFilter(target, own, (value, index) => { visits.push(index); return value !== undefined; });
const copy = result.values; const outputPresence = result.present;
assert.compareArray(copy, []); assert.compareArray(outputPresence, []);
assert.compareArray(visits, []);
const presence: boolean[] = []; for (let i = 0; i < target.length; i++) presence.push(own[i]);
assert.compareArray(presence, [false, false]);
console.log("visiting-filter-only-holes:ok");
