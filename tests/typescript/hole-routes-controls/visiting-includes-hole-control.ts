/*---
description: "includes(undefined) finds a middle hole through indexed value reads. (control)"
features: [ts-hole-routes, ts-hole-route-visiting, ts-arrays]
---*/

// includes(undefined) finds a middle hole through indexed value reads. Route: generic helper. Node prints visiting-includes-hole:ok.
type V = number | undefined;
const items: V[] = []; const own: boolean[] = [];
const cells: readonly (readonly [boolean, V])[] = [[true, 1], [false, undefined], [true, 3]];
for (const cell of cells) { items.push(cell[1]); own.push(cell[0]); }
function localIncludes(xs: V[], own: boolean[], item: V): boolean { for (let i = 0; i < xs.length; i++) if ((own[i] ? xs[i] : undefined) === item) return true; return false; }
function take<T>(xs: T[]): T[] { return xs; }
const target = take<V>(items);
const result = localIncludes(target, own, undefined);
assert.sameValue(result, true);
assert.sameValue(localIncludes(target, own, 9), false);
const presence: boolean[] = []; for (let i = 0; i < target.length; i++) presence.push(own[i]);
assert.compareArray(presence, [true, false, true]);
console.log("visiting-includes-hole:ok");
