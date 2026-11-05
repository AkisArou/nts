/*---
description: "fill(0) replaces both holes with present zero values and returns the original array. (control)"
features: [ts-hole-routes, ts-hole-route-changing, ts-arrays]
---*/

// fill(0) replaces both holes with present zero values and returns the original array. Route: generic helper. Node prints changing-fill-all:ok.
type V = number | undefined;
const items: V[] = [], present: boolean[] = [];
const cells: readonly (readonly [boolean, V])[] = [[false, undefined], [false, undefined]];
for (const cell of cells) { items.push(cell[1]); present.push(cell[0]); }
function localFill(values: V[], present: boolean[], value: V, start: number = 0, end: number = values.length): V[] { for (let i = start; i < end; i++) { values[i] = value; present[i] = true; } return values; }
function relay<T>(xs: T[]): T[] { return xs; }
const target = relay<V>(items);
const result = localFill(target, present, 0);
const current: V[] = [], currentOwn: boolean[] = [];
for (let i = 0; i < target.length; i++) { current.push(present[i] ? target[i] : undefined); currentOwn.push(present[i]); }
assert.compareArray(current, [0, 0]);
assert.compareArray(currentOwn, [true, true]);
assert.sameValue(result, target);
console.log("changing-fill-all:ok");
