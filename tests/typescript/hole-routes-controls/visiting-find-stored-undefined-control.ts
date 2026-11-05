/*---
description: "find visits both a hole and a separately stored undefined when every predicate result is false. (control)"
features: [ts-hole-routes, ts-hole-route-visiting, ts-arrays]
---*/

// find visits both a hole and a separately stored undefined when every predicate result is false. Route: guarded Map.get lookup. Node prints visiting-find-stored-undefined:ok.
type V = number | undefined;
const items: V[] = []; const own: boolean[] = [];
const cells: readonly (readonly [boolean, V])[] = [[true, 1], [false, undefined], [true, undefined], [true, 3]];
for (const cell of cells) { items.push(cell[1]); own.push(cell[0]); }
function localFind(xs: V[], own: boolean[], visit: (value: V, i: number) => boolean): V { for (let i = 0; i < xs.length; i++) if (visit(own[i] ? xs[i] : undefined, i)) return own[i] ? xs[i] : undefined; return undefined; }
const table = new Map<string, V[]>(); table.set("array", items);
const maybe = table.get("array"); if (maybe === undefined) throw new Error("missing"); const target = maybe;
const visits: number[] = [];
const result = localFind(target, own, (value, index) => { visits.push(index); return false; });
assert.sameValue(result, undefined); assert.compareArray(visits, [0, 1, 2, 3]);
const presence: boolean[] = []; for (let i = 0; i < target.length; i++) presence.push(own[i]);
assert.compareArray(presence, [true, false, true, true]);
console.log("visiting-find-stored-undefined:ok");
