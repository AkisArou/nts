/*---
description: "indexOf(undefined) does not match a middle hole and returns -1. (control)"
features: [ts-hole-routes, ts-hole-route-visiting, ts-arrays]
---*/

// indexOf(undefined) does not match a middle hole and returns -1. Route: interface array holder. Node prints visiting-index-of-hole:ok.
type V = number | undefined;
const items: V[] = []; const own: boolean[] = [];
const cells: readonly (readonly [boolean, V])[] = [[true, 1], [false, undefined], [true, 3]];
for (const cell of cells) { items.push(cell[1]); own.push(cell[0]); }
function localIndexOf(xs: V[], own: boolean[], item: V): number { for (let i = 0; i < xs.length; i++) if (own[i] && xs[i] === item) return i; return -1; }
interface Carrier { data: V[]; }
const carrier: Carrier = { data: items }; const target = carrier.data;
const result = localIndexOf(target, own, undefined);
assert.sameValue(result, -1);
assert.sameValue(localIndexOf(target, own, 3), 2);
const presence: boolean[] = []; for (let i = 0; i < target.length; i++) presence.push(own[i]);
assert.compareArray(presence, [true, false, true]);
console.log("visiting-index-of-hole:ok");
