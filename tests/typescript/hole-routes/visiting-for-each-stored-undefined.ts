/*---
description: "forEach skips the leading hole but calls back for a stored undefined and the final number."
features: [ts-hole-routes, ts-hole-route-visiting, ts-arrays]
---*/

// forEach skips the leading hole but calls back for a stored undefined and the final number. Route: generic helper. Node prints visiting-for-each-stored-undefined:ok.
type V = number | undefined;
const items: V[] = [, undefined, 3];
function take<T>(xs: T[]): T[] { return xs; }
const target = take<V>(items);
const visits: number[] = [];
const result = target.forEach((value, index) => { visits.push(index); });
assert.sameValue(result, undefined);
assert.compareArray(visits, [1, 2]);
const presence: boolean[] = []; for (let i = 0; i < target.length; i++) presence.push(i in target);
assert.compareArray(presence, [false, true, true]);
console.log("visiting-for-each-stored-undefined:ok");
