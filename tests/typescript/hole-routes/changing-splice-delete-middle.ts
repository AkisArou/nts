/*---
description: "splice(1, 2) returns a hole followed by 3 and leaves [1, 4]."
features: [ts-hole-routes, ts-hole-route-changing, ts-arrays]
---*/

// splice(1, 2) returns a hole followed by 3 and leaves [1, 4]. Route: captured closure. Node prints changing-splice-delete-middle:ok.
type V = number | undefined;
const items: V[] = [1, , 3, 4];
let captured: V[] = items; const reader = (): V[] => captured; const target = reader();
const result = target.splice(1, 2);
const current: V[] = [], currentOwn: boolean[] = [];
for (let i = 0; i < target.length; i++) { current.push(target[i]); currentOwn.push(i in target); }
assert.compareArray(current, [1, 4]);
assert.compareArray(currentOwn, [true, true]);
const removed = result;
const removedOwn: boolean[] = []; for (let i = 0; i < removed.length; i++) removedOwn.push(i in removed);
const removedValues: V[] = []; for (let i = 0; i < removed.length; i++) removedValues.push(removed[i]);
assert.compareArray(removedValues, [undefined, 3]); assert.compareArray(removedOwn, [false, true]);
console.log("changing-splice-delete-middle:ok");
