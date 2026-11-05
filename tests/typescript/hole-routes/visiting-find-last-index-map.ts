/*---
description: "findLastIndex visits the middle hole as undefined and returns index 1."
features: [ts-hole-routes, ts-hole-route-visiting, ts-arrays]
---*/

// findLastIndex visits the middle hole as undefined and returns index 1. Route: guarded Map.get lookup. Node prints visiting-find-last-index-map:ok.
type V = number | undefined;
const items: V[] = [1, , 3];
const table = new Map<string, V[]>(); table.set("array", items);
const maybe = table.get("array"); if (maybe === undefined) throw new Error("missing"); const target = maybe;
const visits: number[] = [];
const result = target.findLastIndex((value, index) => { visits.push(index); return value === undefined; });
assert.sameValue(result, 1); assert.compareArray(visits, [2, 1]);
const presence: boolean[] = []; for (let i = 0; i < target.length; i++) presence.push(i in target);
assert.compareArray(presence, [true, false, true]);
console.log("visiting-find-last-index-map:ok");
