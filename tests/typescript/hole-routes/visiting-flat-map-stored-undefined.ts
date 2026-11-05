/*---
description: "flatMap visits stored undefined, skips the adjacent hole, and preserves two undefined results."
features: [ts-hole-routes, ts-hole-route-visiting, ts-arrays]
---*/

// flatMap visits stored undefined, skips the adjacent hole, and preserves two undefined results. Route: generic helper. Node prints visiting-flat-map-stored-undefined:ok.
type V = number | undefined;
const items: V[] = [undefined, , 3];
function take<T>(xs: T[]): T[] { return xs; }
const target = take<V>(items);
const visits: number[] = [];
const result = target.flatMap((value, index) => { visits.push(index); return [value, value]; });
const copy = result; const outputPresence: boolean[] = []; for (let i = 0; i < copy.length; i++) outputPresence.push(i in copy);
assert.compareArray(copy, [undefined, undefined, 3, 3]); assert.compareArray(outputPresence, [true, true, true, true]);
assert.compareArray(visits, [0, 2]);
const presence: boolean[] = []; for (let i = 0; i < target.length; i++) presence.push(i in target);
assert.compareArray(presence, [true, false, true]);
console.log("visiting-flat-map-stored-undefined:ok");
