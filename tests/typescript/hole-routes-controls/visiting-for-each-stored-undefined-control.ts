/*---
description: "forEach skips the leading hole but calls back for a stored undefined and the final number. (control)"
features: [ts-hole-routes, ts-hole-route-visiting, ts-arrays]
---*/

// forEach skips the leading hole but calls back for a stored undefined and the final number. Route: generic helper. Node prints visiting-for-each-stored-undefined:ok.
type V = number | undefined;
const items: V[] = []; const own: boolean[] = [];
const cells: readonly (readonly [boolean, V])[] = [[false, undefined], [true, undefined], [true, 3]];
for (const cell of cells) { items.push(cell[1]); own.push(cell[0]); }
function localForEach(xs: V[], own: boolean[], visit: (value: V, i: number) => void): void { for (let i = 0; i < xs.length; i++) if (own[i]) visit(xs[i], i); }
function take<T>(xs: T[]): T[] { return xs; }
const target = take<V>(items);
const visits: number[] = [];
const result = localForEach(target, own, (value, index) => { visits.push(index); });
assert.sameValue(result, undefined);
assert.compareArray(visits, [1, 2]);
const presence: boolean[] = []; for (let i = 0; i < target.length; i++) presence.push(own[i]);
assert.compareArray(presence, [false, true, true]);
console.log("visiting-for-each-stored-undefined:ok");
