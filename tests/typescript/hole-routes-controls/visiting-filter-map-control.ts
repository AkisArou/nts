/*---
description: "filter skips a hole and removes a stored undefined, producing a dense [1, 3] array. (control)"
features: [ts-hole-routes, ts-hole-route-visiting, ts-arrays]
---*/

// filter skips a hole and removes a stored undefined, producing a dense [1, 3] array. Route: guarded Map.get lookup. Node prints visiting-filter-map:ok.
type V = number | undefined;
const items: V[] = []; const own: boolean[] = [];
const cells: readonly (readonly [boolean, V])[] = [[true, 1], [false, undefined], [true, undefined], [true, 3]];
for (const cell of cells) { items.push(cell[1]); own.push(cell[0]); }
function localFilter(xs: V[], own: boolean[], visit: (value: V, i: number) => boolean): { values: V[]; present: boolean[] } { const values: V[] = []; const present: boolean[] = []; for (let i = 0; i < xs.length; i++) if (own[i] && visit(xs[i], i)) { values.push(xs[i]); present.push(true); } return { values, present }; }
const table = new Map<string, V[]>(); table.set("array", items);
const maybe = table.get("array"); if (maybe === undefined) throw new Error("missing"); const target = maybe;
const visits: number[] = [];
const result = localFilter(target, own, (value, index) => { visits.push(index); return value !== undefined; });
const copy = result.values; const outputPresence = result.present;
assert.compareArray(copy, [1, 3]); assert.compareArray(outputPresence, [true, true]);
assert.compareArray(visits, [0, 2, 3]);
const presence: boolean[] = []; for (let i = 0; i < target.length; i++) presence.push(own[i]);
assert.compareArray(presence, [true, false, true, true]);
console.log("visiting-filter-map:ok");
