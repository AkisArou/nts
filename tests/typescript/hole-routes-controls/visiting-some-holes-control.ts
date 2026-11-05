/*---
description: "some over an all-hole array returns false without invoking its predicate. (control)"
features: [ts-hole-routes, ts-hole-route-visiting, ts-arrays]
---*/

// some over an all-hole array returns false without invoking its predicate. Route: discriminated union. Node prints visiting-some-holes:ok.
type V = number | undefined;
const items: V[] = []; const own: boolean[] = [];
const cells: readonly (readonly [boolean, V])[] = [[false, undefined], [false, undefined]];
for (const cell of cells) { items.push(cell[1]); own.push(cell[0]); }
function localSome(xs: V[], own: boolean[], visit: (value: V, i: number) => boolean): boolean { for (let i = 0; i < xs.length; i++) if (own[i] && visit(xs[i], i)) return true; return false; }
type Input = { tag: "yes"; data: V[] } | { tag: "no"; data: V[] };
const holder: Input = { tag: "yes", data: items }; const target = holder.data;
const visits: number[] = [];
const result = localSome(target, own, (value, index) => { visits.push(index); return true; });
assert.sameValue(result, false); assert.compareArray(visits, []);
const presence: boolean[] = []; for (let i = 0; i < target.length; i++) presence.push(own[i]);
assert.compareArray(presence, [false, false]);
console.log("visiting-some-holes:ok");
