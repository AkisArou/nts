/*---
description: "filter skips a hole and removes a stored undefined, producing a dense [1, 3] array."
features: [ts-hole-routes, ts-hole-route-visiting, ts-arrays]
---*/

// filter skips a hole and removes a stored undefined, producing a dense [1, 3] array. Route: guarded Map.get lookup. Node prints visiting-filter-map:ok.
type V = number | undefined;
const items: V[] = [1, , undefined, 3];
const table = new Map<string, V[]>(); table.set("array", items);
const maybe = table.get("array"); if (maybe === undefined) throw new Error("missing"); const target = maybe;
const visits: number[] = [];
const result = target.filter((value, index) => { visits.push(index); return value !== undefined; });
const copy = result; const outputPresence: boolean[] = []; for (let i = 0; i < copy.length; i++) outputPresence.push(i in copy);
assert.compareArray(copy, [1, 3]); assert.compareArray(outputPresence, [true, true]);
assert.compareArray(visits, [0, 2, 3]);
const presence: boolean[] = []; for (let i = 0; i < target.length; i++) presence.push(i in target);
assert.compareArray(presence, [true, false, true, true]);
console.log("visiting-filter-map:ok");
