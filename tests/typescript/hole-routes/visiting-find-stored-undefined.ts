/*---
description: "find visits both a hole and a separately stored undefined when every predicate result is false."
features: [ts-hole-routes, ts-hole-route-visiting, ts-arrays]
---*/

// find visits both a hole and a separately stored undefined when every predicate result is false. Route: guarded Map.get lookup. Node prints visiting-find-stored-undefined:ok.
type V = number | undefined;
const items: V[] = [1, , undefined, 3];
const table = new Map<string, V[]>(); table.set("array", items);
const maybe = table.get("array"); if (maybe === undefined) throw new Error("missing"); const target = maybe;
const visits: number[] = [];
const result = target.find((value, index) => { visits.push(index); return false; });
assert.sameValue(result, undefined); assert.compareArray(visits, [0, 1, 2, 3]);
const presence: boolean[] = []; for (let i = 0; i < target.length; i++) presence.push(i in target);
assert.compareArray(presence, [true, false, true, true]);
console.log("visiting-find-stored-undefined:ok");
