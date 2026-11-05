/*---
description: "growing length from two to five adds three holes, not stored undefined values."
features: [ts-hole-routes, ts-hole-route-changing, ts-arrays]
---*/

// growing length from two to five adds three holes, not stored undefined values. Route: readonly tuple row. Node prints changing-length-grow:ok.
type V = number | undefined;
const items: V[] = [1, 2];
const rows: readonly [string, V[]][] = [["a", items]];
const target = rows[0][1];
target.length = 5;
const current: V[] = [], currentOwn: boolean[] = [];
for (let i = 0; i < target.length; i++) { current.push(target[i]); currentOwn.push(i in target); }
assert.compareArray(current, [1, 2, undefined, undefined, undefined]);
assert.compareArray(currentOwn, [true, true, false, false, false]);
console.log("changing-length-grow:ok");
