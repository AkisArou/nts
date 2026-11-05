/*---
description: "splice(3, 0, 9) appends a number while preserving the earlier hole. (control)"
features: [ts-hole-routes, ts-hole-route-changing, ts-arrays]
---*/

// splice(3, 0, 9) appends a number while preserving the earlier hole. Route: generic helper. Node prints changing-splice-insert-end:ok.
type V = number | undefined;
const items: V[] = [], present: boolean[] = [];
const cells: readonly (readonly [boolean, V])[] = [[true, 1], [false, undefined], [true, 3]];
for (const cell of cells) { items.push(cell[1]); present.push(cell[0]); }
function localSplice(values: V[], present: boolean[], index: number, count: number, insert?: V): { values: V[]; present: boolean[] } { const removed: V[] = [], removedOwn: boolean[] = [], next: V[] = [], nextOwn: boolean[] = []; for (let i = 0; i < index; i++) { next.push(values[i]); nextOwn.push(present[i]); } for (let i = index; i < index + count && i < values.length; i++) { removed.push(present[i] ? values[i] : undefined); removedOwn.push(present[i]); } if (insert !== undefined) { next.push(insert); nextOwn.push(true); } for (let i = index + count; i < values.length; i++) { next.push(values[i]); nextOwn.push(present[i]); } while (values.length > 0) { values.pop(); present.pop(); } for (let i = 0; i < next.length; i++) { values.push(next[i]); present.push(nextOwn[i]); } return { values: removed, present: removedOwn }; }
function relay<T>(xs: T[]): T[] { return xs; }
const target = relay<V>(items);
const result = localSplice(target, present, 3, 0, 9);
const current: V[] = [], currentOwn: boolean[] = [];
for (let i = 0; i < target.length; i++) { current.push(present[i] ? target[i] : undefined); currentOwn.push(present[i]); }
assert.compareArray(current, [1, undefined, 3, 9]);
assert.compareArray(currentOwn, [true, false, true, true]);
const removed = result.values;
const removedOwn: boolean[] = []; for (let i = 0; i < removed.length; i++) removedOwn.push(result.present[i]);
const removedValues: V[] = []; for (let i = 0; i < removed.length; i++) removedValues.push(removedOwn[i] ? removed[i] : undefined);
assert.compareArray(removedValues, []); assert.compareArray(removedOwn, []);
console.log("changing-splice-insert-end:ok");
