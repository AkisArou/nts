/*---
description: "reduce over three holes without an initial value throws TypeError without a callback."
features: [ts-hole-routes, ts-hole-route-visiting, ts-arrays]
---*/

// reduce over three holes without an initial value throws TypeError without a callback. Route: generic helper. Node prints visiting-reduce-only-holes:ok.
type V = number | undefined;
const items: V[] = new Array<V>(3);
function take<T>(xs: T[]): T[] { return xs; }
const target = take<V>(items);
const visits: number[] = [];
assert.throws(TypeError, () => target.reduce((sum, value, index) => { visits.push(index); return (sum ?? 0) + (value ?? 0); }));
assert.compareArray(visits, []);
const presence: boolean[] = []; for (let i = 0; i < target.length; i++) presence.push(i in target);
assert.compareArray(presence, [false, false, false]);
console.log("visiting-reduce-only-holes:ok");
