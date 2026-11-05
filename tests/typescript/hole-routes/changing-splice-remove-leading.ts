/*---
description: "splice(0, 1) removes the first value and shifts a hole into index 0."
features: [ts-hole-routes, ts-hole-route-changing, ts-arrays]
---*/

// splice(0, 1) removes the first value and shifts a hole into index 0. Route: readonly tuple row. Node prints changing-splice-remove-leading:ok.
type V = number | undefined;
const items: V[] = [1, , 3];
const rows: readonly [string, V[]][] = [["a", items]];
const target = rows[0][1];
const result = target.splice(0, 1);
const current: V[] = [], currentOwn: boolean[] = [];
for (let i = 0; i < target.length; i++) { current.push(target[i]); currentOwn.push(i in target); }
assert.compareArray(current, [undefined, 3]);
assert.compareArray(currentOwn, [false, true]);
const removed = result;
const removedOwn: boolean[] = []; for (let i = 0; i < removed.length; i++) removedOwn.push(i in removed);
const removedValues: V[] = []; for (let i = 0; i < removed.length; i++) removedValues.push(removed[i]);
assert.compareArray(removedValues, [1]); assert.compareArray(removedOwn, [true]);
console.log("changing-splice-remove-leading:ok");
