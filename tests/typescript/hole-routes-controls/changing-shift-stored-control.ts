/*---
description: "shift returns a stored undefined and moves the next hole to the front. (control)"
features: [ts-hole-routes, ts-hole-route-changing, ts-arrays]
---*/

// shift returns a stored undefined and moves the next hole to the front. Route: readonly tuple row. Node prints changing-shift-stored:ok.
type V = number | undefined;
const items: V[] = [], present: boolean[] = [];
const cells: readonly (readonly [boolean, V])[] = [[true, undefined], [false, undefined], [true, 3]];
for (const cell of cells) { items.push(cell[1]); present.push(cell[0]); }
function localShift(values: V[], present: boolean[]): V { if (values.length === 0) return undefined; const result = present[0] ? values[0] : undefined; for (let i = 1; i < values.length; i++) { values[i - 1] = values[i]; present[i - 1] = present[i]; } values.pop(); present.pop(); return result; }
const rows: readonly [string, V[]][] = [["a", items]];
const target = rows[0][1];
const result = localShift(target, present);
const current: V[] = [], currentOwn: boolean[] = [];
for (let i = 0; i < target.length; i++) { current.push(present[i] ? target[i] : undefined); currentOwn.push(present[i]); }
assert.compareArray(current, [undefined, 3]);
assert.compareArray(currentOwn, [false, true]);
assert.sameValue(result, undefined);
console.log("changing-shift-stored:ok");
