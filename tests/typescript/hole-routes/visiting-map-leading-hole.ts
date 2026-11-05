/*---
description: "map retains the leading hole and invokes its callback for a present undefined."
features: [ts-hole-routes, ts-hole-route-visiting, ts-arrays]
---*/

// map retains the leading hole and invokes its callback for a present undefined. Route: guarded Map.get lookup. Node prints visiting-map-leading-hole:ok.
type V = number | undefined;
const items: V[] = [, 2, undefined];
const table = new Map<string, V[]>(); table.set("array", items);
const maybe = table.get("array"); if (maybe === undefined) throw new Error("missing"); const target = maybe;
const visits: number[] = [];
const result = target.map((value, index) => { visits.push(index); return value === undefined ? 0 : value * 10; });
const copy = result; const outputPresence: boolean[] = []; for (let i = 0; i < copy.length; i++) outputPresence.push(i in copy);
const actual: V[] = []; for (let i = 0; i < copy.length; i++) actual.push(copy[i]);
assert.compareArray(actual, [undefined, 20, 0]); assert.compareArray(outputPresence, [false, true, true]);
assert.compareArray(visits, [1, 2]);
const presence: boolean[] = []; for (let i = 0; i < target.length; i++) presence.push(i in target);
assert.compareArray(presence, [false, true, true]);
console.log("visiting-map-leading-hole:ok");
