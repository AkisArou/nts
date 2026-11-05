/*---
description: "every on an array containing only holes returns true without invoking its callback."
features: [ts-hole-routes, ts-hole-route-visiting, ts-arrays]
---*/

// every on an array containing only holes returns true without invoking its callback. Route: guarded Map.get lookup. Node prints visiting-every-holes:ok.
type V = number | undefined;
const items: V[] = [, ,];
const table = new Map<string, V[]>(); table.set("array", items);
const maybe = table.get("array"); if (maybe === undefined) throw new Error("missing"); const target = maybe;
const visits: number[] = [];
const result = target.every((value, index) => { visits.push(index); return true; });
assert.sameValue(result, true); assert.compareArray(visits, []);
const presence: boolean[] = []; for (let i = 0; i < target.length; i++) presence.push(i in target);
assert.compareArray(presence, [false, false]);
console.log("visiting-every-holes:ok");
