/*---
description: "splice(1, 0, 9) inserts before a hole and shifts that hole to index 2."
features: [ts-hole-routes, ts-hole-route-changing, ts-arrays]
---*/

// splice(1, 0, 9) inserts before a hole and shifts that hole to index 2. Route: discriminated union. Node prints changing-splice-insert-middle:ok.
type V = number | undefined;
const items: V[] = [1, , 3];
type Route = { kind: "yes"; array: V[] } | { kind: "no"; array: V[] };
const r: Route = { kind: "yes", array: items }; const target = r.array;
const result = target.splice(1, 0, 9);
const current: V[] = [], currentOwn: boolean[] = [];
for (let i = 0; i < target.length; i++) { current.push(target[i]); currentOwn.push(i in target); }
assert.compareArray(current, [1, 9, undefined, 3]);
assert.compareArray(currentOwn, [true, true, false, true]);
const removed = result;
const removedOwn: boolean[] = []; for (let i = 0; i < removed.length; i++) removedOwn.push(i in removed);
const removedValues: V[] = []; for (let i = 0; i < removed.length; i++) removedValues.push(removed[i]);
assert.compareArray(removedValues, []); assert.compareArray(removedOwn, []);
console.log("changing-splice-insert-middle:ok");
