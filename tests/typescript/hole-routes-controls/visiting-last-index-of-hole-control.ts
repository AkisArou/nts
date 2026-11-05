/*---
description: "lastIndexOf(undefined) skips the hole at index 2 and finds the earlier stored undefined at index 1. (control)"
features: [ts-hole-routes, ts-hole-route-visiting, ts-arrays]
---*/

// lastIndexOf(undefined) skips the hole at index 2 and finds the earlier stored undefined at index 1. Route: guarded Map.get lookup. Node prints visiting-last-index-of-hole:ok.
type V = number | undefined;
const items: V[] = []; const own: boolean[] = [];
const cells: readonly (readonly [boolean, V])[] = [[true, 1], [true, undefined], [false, undefined], [true, 3]];
for (const cell of cells) { items.push(cell[1]); own.push(cell[0]); }
function localLastIndexOf(xs: V[], own: boolean[], item: V): number { for (let i = xs.length - 1; i >= 0; i--) if (own[i] && xs[i] === item) return i; return -1; }
const table = new Map<string, V[]>(); table.set("array", items);
const maybe = table.get("array"); if (maybe === undefined) throw new Error("missing"); const target = maybe;
const result = localLastIndexOf(target, own, undefined);
assert.sameValue(result, 1);
assert.sameValue(localLastIndexOf(target, own, 1), 0);
const presence: boolean[] = []; for (let i = 0; i < target.length; i++) presence.push(own[i]);
assert.compareArray(presence, [true, true, false, true]);
console.log("visiting-last-index-of-hole:ok");
