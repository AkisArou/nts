/*---
description: "includes(undefined) finds a middle hole through indexed value reads."
features: [ts-hole-routes, ts-hole-route-visiting, ts-arrays]
---*/

// includes(undefined) finds a middle hole through indexed value reads. Route: generic helper. Node prints visiting-includes-hole:ok.
type V = number | undefined;
const items: V[] = [1, , 3];
function take<T>(xs: T[]): T[] { return xs; }
const target = take<V>(items);
const result = target.includes(undefined);
assert.sameValue(result, true);
assert.sameValue(target.includes(9), false);
const presence: boolean[] = []; for (let i = 0; i < target.length; i++) presence.push(i in target);
assert.compareArray(presence, [true, false, true]);
console.log("visiting-includes-hole:ok");
