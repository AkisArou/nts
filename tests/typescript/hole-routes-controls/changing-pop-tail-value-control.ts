/*---
description: "pop removes a present final number while preserving the preceding hole. (control)"
features: [ts-hole-routes, ts-hole-route-changing, ts-arrays]
---*/

// pop removes a present final number while preserving the preceding hole. Route: readonly tuple row. Node prints changing-pop-tail-value:ok.
type V = number | undefined;
const items: V[] = [], present: boolean[] = [];
const cells: readonly (readonly [boolean, V])[] = [[true, 1], [false, undefined], [true, 3]];
for (const cell of cells) { items.push(cell[1]); present.push(cell[0]); }
function localPop(values: V[], present: boolean[]): V { const own = present.length > 0 && present[present.length - 1]; const value = values.pop(); present.pop(); return own ? value : undefined; }
const rows: readonly [string, V[]][] = [["a", items]];
const target = rows[0][1];
const result = localPop(target, present);
const current: V[] = [], currentOwn: boolean[] = [];
for (let i = 0; i < target.length; i++) { current.push(present[i] ? target[i] : undefined); currentOwn.push(present[i]); }
assert.compareArray(current, [1, undefined]);
assert.compareArray(currentOwn, [true, false]);
assert.sameValue(result, 3);
console.log("changing-pop-tail-value:ok");
