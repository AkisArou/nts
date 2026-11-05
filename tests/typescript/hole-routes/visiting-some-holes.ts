/*---
description: "some over an all-hole array returns false without invoking its predicate."
features: [ts-hole-routes, ts-hole-route-visiting, ts-arrays]
---*/

// some over an all-hole array returns false without invoking its predicate. Route: discriminated union. Node prints visiting-some-holes:ok.
type V = number | undefined;
const items: V[] = [, ,];
type Input = { tag: "yes"; data: V[] } | { tag: "no"; data: V[] };
const holder: Input = { tag: "yes", data: items }; const target = holder.data;
const visits: number[] = [];
const result = target.some((value, index) => { visits.push(index); return true; });
assert.sameValue(result, false); assert.compareArray(visits, []);
const presence: boolean[] = []; for (let i = 0; i < target.length; i++) presence.push(i in target);
assert.compareArray(presence, [false, false]);
console.log("visiting-some-holes:ok");
