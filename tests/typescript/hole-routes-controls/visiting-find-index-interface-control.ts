/*---
description: "findIndex calls its predicate on the middle hole as undefined and returns index 1. (control)"
features: [ts-hole-routes, ts-hole-route-visiting, ts-arrays]
---*/

// findIndex calls its predicate on the middle hole as undefined and returns index 1. Route: interface array holder. Node prints visiting-find-index-interface:ok.
type V = number | undefined;
const items: V[] = []; const own: boolean[] = [];
const cells: readonly (readonly [boolean, V])[] = [[true, 1], [false, undefined], [true, 3]];
for (const cell of cells) { items.push(cell[1]); own.push(cell[0]); }
function localFindIndex(xs: V[], own: boolean[], visit: (value: V, i: number) => boolean): number { for (let i = 0; i < xs.length; i++) if (visit(own[i] ? xs[i] : undefined, i)) return i; return -1; }
interface Carrier { data: V[]; }
const carrier: Carrier = { data: items }; const target = carrier.data;
const visits: number[] = [];
const result = localFindIndex(target, own, (value, index) => { visits.push(index); return value === undefined; });
assert.sameValue(result, 1); assert.compareArray(visits, [0, 1]);
const presence: boolean[] = []; for (let i = 0; i < target.length; i++) presence.push(own[i]);
assert.compareArray(presence, [true, false, true]);
console.log("visiting-find-index-interface:ok");
