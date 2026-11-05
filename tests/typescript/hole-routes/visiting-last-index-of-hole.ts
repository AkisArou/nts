/*---
description: "lastIndexOf(undefined) skips the hole at index 2 and finds the earlier stored undefined at index 1."
features: [ts-hole-routes, ts-hole-route-visiting, ts-arrays]
---*/

// lastIndexOf(undefined) skips the hole at index 2 and finds the earlier stored undefined at index 1. Route: guarded Map.get lookup. Node prints visiting-last-index-of-hole:ok.
type V = number | undefined;
const items: V[] = [1, undefined, , 3];
const table = new Map<string, V[]>(); table.set("array", items);
const maybe = table.get("array"); if (maybe === undefined) throw new Error("missing"); const target = maybe;
const result = target.lastIndexOf(undefined);
assert.sameValue(result, 1);
assert.sameValue(target.lastIndexOf(1), 0);
const presence: boolean[] = []; for (let i = 0; i < target.length; i++) presence.push(i in target);
assert.compareArray(presence, [true, true, false, true]);
console.log("visiting-last-index-of-hole:ok");
