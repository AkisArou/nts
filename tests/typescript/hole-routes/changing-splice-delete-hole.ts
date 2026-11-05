/*---
description: "splice(0, 1) returns a single removed hole as a hole and shifts the other slots."
features: [ts-hole-routes, ts-hole-route-changing, ts-arrays]
---*/

// splice(0, 1) returns a single removed hole as a hole and shifts the other slots. Route: interface field. Node prints changing-splice-delete-hole:ok.
type V = number | undefined;
const items: V[] = [, 2, , 4];
interface Carrier { values: V[]; }
const holder: Carrier = { values: items }; const target = holder.values;
const result = target.splice(0, 1);
const current: V[] = [], currentOwn: boolean[] = [];
for (let i = 0; i < target.length; i++) { current.push(target[i]); currentOwn.push(i in target); }
assert.compareArray(current, [2, undefined, 4]);
assert.compareArray(currentOwn, [true, false, true]);
const removed = result;
const removedOwn: boolean[] = []; for (let i = 0; i < removed.length; i++) removedOwn.push(i in removed);
const removedValues: V[] = []; for (let i = 0; i < removed.length; i++) removedValues.push(removed[i]);
assert.compareArray(removedValues, [undefined]); assert.compareArray(removedOwn, [false]);
console.log("changing-splice-delete-hole:ok");
