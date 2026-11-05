/*---
description: "pop removes a trailing hole and returns undefined while preserving the first element. (control)"
features: [ts-hole-routes, ts-hole-route-changing, ts-arrays]
---*/

// pop removes a trailing hole and returns undefined while preserving the first element. Route: captured closure. Node prints changing-pop-tail-hole:ok.
type V = number | undefined;
const items: V[] = [], present: boolean[] = [];
const cells: readonly (readonly [boolean, V])[] = [[true, 1], [false, undefined]];
for (const cell of cells) { items.push(cell[1]); present.push(cell[0]); }
function localPop(values: V[], present: boolean[]): V { const own = present.length > 0 && present[present.length - 1]; const value = values.pop(); present.pop(); return own ? value : undefined; }
let captured: V[] = items; const reader = (): V[] => captured; const target = reader();
const result = localPop(target, present);
const current: V[] = [], currentOwn: boolean[] = [];
for (let i = 0; i < target.length; i++) { current.push(present[i] ? target[i] : undefined); currentOwn.push(present[i]); }
assert.compareArray(current, [1]);
assert.compareArray(currentOwn, [true]);
assert.sameValue(result, undefined);
console.log("changing-pop-tail-hole:ok");
