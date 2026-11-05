/*---
description: "splice(3, 0, 9) appends a number while preserving the earlier hole."
features: [ts-hole-routes, ts-hole-route-changing, ts-arrays]
---*/

// splice(3, 0, 9) appends a number while preserving the earlier hole. Route: generic helper. Node prints changing-splice-insert-end:ok.
type V = number | undefined;
const items: V[] = [1, , 3];
function relay<T>(xs: T[]): T[] { return xs; }
const target = relay<V>(items);
const result = target.splice(3, 0, 9);
const current: V[] = [], currentOwn: boolean[] = [];
for (let i = 0; i < target.length; i++) { current.push(target[i]); currentOwn.push(i in target); }
assert.compareArray(current, [1, undefined, 3, 9]);
assert.compareArray(currentOwn, [true, false, true, true]);
const removed = result;
const removedOwn: boolean[] = []; for (let i = 0; i < removed.length; i++) removedOwn.push(i in removed);
const removedValues: V[] = []; for (let i = 0; i < removed.length; i++) removedValues.push(removed[i]);
assert.compareArray(removedValues, []); assert.compareArray(removedOwn, []);
console.log("changing-splice-insert-end:ok");
