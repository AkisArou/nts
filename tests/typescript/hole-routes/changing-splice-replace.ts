/*---
description: "splice(1, 2, 9) returns the removed hole as a hole and leaves [1, 9, 4]."
features: [ts-hole-routes, ts-hole-route-changing, ts-arrays]
---*/

// splice(1, 2, 9) returns the removed hole as a hole and leaves [1, 9, 4]. Route: private class field. Node prints changing-splice-replace:ok.
type V = number | undefined;
const items: V[] = [1, , 3, 4];
class Box { #data: V[]; constructor(v: V[]) { this.#data = v; } get(): V[] { return this.#data; } }
const target = new Box(items).get();
const result = target.splice(1, 2, 9);
const current: V[] = [], currentOwn: boolean[] = [];
for (let i = 0; i < target.length; i++) { current.push(target[i]); currentOwn.push(i in target); }
assert.compareArray(current, [1, 9, 4]);
assert.compareArray(currentOwn, [true, true, true]);
const removed = result;
const removedOwn: boolean[] = []; for (let i = 0; i < removed.length; i++) removedOwn.push(i in removed);
const removedValues: V[] = []; for (let i = 0; i < removed.length; i++) removedValues.push(removed[i]);
assert.compareArray(removedValues, [undefined, 3]); assert.compareArray(removedOwn, [false, true]);
console.log("changing-splice-replace:ok");
