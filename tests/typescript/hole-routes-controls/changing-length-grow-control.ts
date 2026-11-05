/*---
description: "growing length from two to five adds three holes, not stored undefined values. (control)"
features: [ts-hole-routes, ts-hole-route-changing, ts-arrays]
---*/

// growing length from two to five adds three holes, not stored undefined values. Route: readonly tuple row. Node prints changing-length-grow:ok.
type V = number | undefined;
const items: V[] = [], present: boolean[] = [];
const cells: readonly (readonly [boolean, V])[] = [[true, 1], [true, 2]];
for (const cell of cells) { items.push(cell[1]); present.push(cell[0]); }
function localLength(values: V[], present: boolean[], size: number): void { while (values.length > size) { values.pop(); present.pop(); } while (values.length < size) { values.push(undefined); present.push(false); } }
const rows: readonly [string, V[]][] = [["a", items]];
const target = rows[0][1];
localLength(target, present, 5);
const current: V[] = [], currentOwn: boolean[] = [];
for (let i = 0; i < target.length; i++) { current.push(present[i] ? target[i] : undefined); currentOwn.push(present[i]); }
assert.compareArray(current, [1, 2, undefined, undefined, undefined]);
assert.compareArray(currentOwn, [true, true, false, false, false]);
console.log("changing-length-grow:ok");
