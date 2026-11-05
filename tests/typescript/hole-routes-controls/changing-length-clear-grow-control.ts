/*---
description: "truncating length to zero then regrowing to two leaves two holes and loses previous values. (control)"
features: [ts-hole-routes, ts-hole-route-changing, ts-arrays]
---*/

// truncating length to zero then regrowing to two leaves two holes and loses previous values. Route: captured closure. Node prints changing-length-clear-grow:ok.
type V = number | undefined;
const items: V[] = [], present: boolean[] = [];
const cells: readonly (readonly [boolean, V])[] = [[true, 1], [false, undefined], [true, 3]];
for (const cell of cells) { items.push(cell[1]); present.push(cell[0]); }
function localLength(values: V[], present: boolean[], size: number): void { while (values.length > size) { values.pop(); present.pop(); } while (values.length < size) { values.push(undefined); present.push(false); } }
let captured: V[] = items; const reader = (): V[] => captured; const target = reader();
localLength(target, present, 0); localLength(target, present, 2);
const current: V[] = [], currentOwn: boolean[] = [];
for (let i = 0; i < target.length; i++) { current.push(present[i] ? target[i] : undefined); currentOwn.push(present[i]); }
assert.compareArray(current, [undefined, undefined]);
assert.compareArray(currentOwn, [false, false]);
console.log("changing-length-clear-grow:ok");
