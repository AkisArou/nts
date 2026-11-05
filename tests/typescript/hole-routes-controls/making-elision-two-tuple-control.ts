/*---
description: "Two elisions create two holes and length two. (control)"
features: [ts-hole-routes, ts-hole-route-making, ts-arrays]
---*/

// Two elisions create two holes and length two. Route: readonly tuple rows. Node prints making-elision-two-tuple:ok.
type V = number | string | undefined;
function localElision(values: V[], present: boolean[], cells: readonly (readonly [boolean, V])[]): void { for (let i = 0; i < cells.length; i++) { values.push(cells[i][1]); present.push(cells[i][0]); } }
const items: V[] = []; const present: boolean[] = [];
localElision(items, present, [[false, undefined], [false, undefined]]);
const rows: readonly [string, V[]][] = [["first", items]];
const routed = rows[0][1];
const actual: V[] = []; const observed: boolean[] = [];
for (let i = 0; i < routed.length; i++) { actual.push(present[i] ? routed[i] : undefined); observed.push(present[i]); }
assert.sameValue(routed.length, 2);
assert.compareArray(actual, [undefined, undefined]); assert.compareArray(observed, [false, false]);
console.log("making-elision-two-tuple:ok");
