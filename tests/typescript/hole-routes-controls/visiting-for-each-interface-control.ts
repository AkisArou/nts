/*---
description: "forEach visits indexes 0 and 2 while skipping the absent middle index. (control)"
features: [ts-hole-routes, ts-hole-route-visiting, ts-arrays]
---*/

// forEach visits indexes 0 and 2 while skipping the absent middle index. Route: interface array holder. Node prints visiting-for-each-interface:ok.
type V = number | undefined;
const items: V[] = []; const own: boolean[] = [];
const cells: readonly (readonly [boolean, V])[] = [[true, 1], [false, undefined], [true, 3]];
for (const cell of cells) { items.push(cell[1]); own.push(cell[0]); }
function localForEach(xs: V[], own: boolean[], visit: (value: V, i: number) => void): void { for (let i = 0; i < xs.length; i++) if (own[i]) visit(xs[i], i); }
interface Carrier { data: V[]; }
const carrier: Carrier = { data: items }; const target = carrier.data;
const visits: number[] = [];
const result = localForEach(target, own, (value, index) => { visits.push(index); });
assert.sameValue(result, undefined);
assert.compareArray(visits, [0, 2]);
const presence: boolean[] = []; for (let i = 0; i < target.length; i++) presence.push(own[i]);
assert.compareArray(presence, [true, false, true]);
console.log("visiting-for-each-interface:ok");
