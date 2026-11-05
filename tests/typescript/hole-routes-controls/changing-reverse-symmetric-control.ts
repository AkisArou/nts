/*---
description: "reverse preserves the middle hole at index 1 while swapping its two neighboring numbers. (control)"
features: [ts-hole-routes, ts-hole-route-changing, ts-arrays]
---*/

// reverse preserves the middle hole at index 1 while swapping its two neighboring numbers. Route: generic helper. Node prints changing-reverse-symmetric:ok.
type V = number | undefined;
const items: V[] = [], present: boolean[] = [];
const cells: readonly (readonly [boolean, V])[] = [[true, 1], [false, undefined], [true, 3]];
for (const cell of cells) { items.push(cell[1]); present.push(cell[0]); }
function localReverse(values: V[], present: boolean[]): V[] { for (let i = 0; i < values.length / 2; i++) { const j = values.length - 1 - i; const v = values[i], f = present[i]; values[i] = values[j]; present[i] = present[j]; values[j] = v; present[j] = f; } return values; }
function relay<T>(xs: T[]): T[] { return xs; }
const target = relay<V>(items);
const result = localReverse(target, present);
const current: V[] = [], currentOwn: boolean[] = [];
for (let i = 0; i < target.length; i++) { current.push(present[i] ? target[i] : undefined); currentOwn.push(present[i]); }
assert.compareArray(current, [3, undefined, 1]);
assert.compareArray(currentOwn, [true, false, true]);
assert.sameValue(result, target);
console.log("changing-reverse-symmetric:ok");
