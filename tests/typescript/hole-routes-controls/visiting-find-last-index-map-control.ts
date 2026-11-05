/*---
description: "findLastIndex visits the middle hole as undefined and returns index 1. (control)"
features: [ts-hole-routes, ts-hole-route-visiting, ts-arrays]
---*/

// findLastIndex visits the middle hole as undefined and returns index 1. Route: guarded Map.get lookup. Node prints visiting-find-last-index-map:ok.
type V = number | undefined;
const items: V[] = []; const own: boolean[] = [];
const cells: readonly (readonly [boolean, V])[] = [[true, 1], [false, undefined], [true, 3]];
for (const cell of cells) { items.push(cell[1]); own.push(cell[0]); }
function localFindLastIndex(xs: V[], own: boolean[], visit: (value: V, i: number) => boolean): number { for (let i = xs.length - 1; i >= 0; i--) if (visit(own[i] ? xs[i] : undefined, i)) return i; return -1; }
const table = new Map<string, V[]>(); table.set("array", items);
const maybe = table.get("array"); if (maybe === undefined) throw new Error("missing"); const target = maybe;
const visits: number[] = [];
const result = localFindLastIndex(target, own, (value, index) => { visits.push(index); return value === undefined; });
assert.sameValue(result, 1); assert.compareArray(visits, [2, 1]);
const presence: boolean[] = []; for (let i = 0; i < target.length; i++) presence.push(own[i]);
assert.compareArray(presence, [true, false, true]);
console.log("visiting-find-last-index-map:ok");
