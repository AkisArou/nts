/*---
description: "unshift(0) shifts a stored undefined and a distinct hole without merging their presence. (control)"
features: [ts-hole-routes, ts-hole-route-changing, ts-arrays]
---*/

// unshift(0) shifts a stored undefined and a distinct hole without merging their presence. Route: generic helper. Node prints changing-unshift-stored:ok.
type V = number | undefined;
const items: V[] = [], present: boolean[] = [];
const cells: readonly (readonly [boolean, V])[] = [[true, undefined], [false, undefined], [true, 3]];
for (const cell of cells) { items.push(cell[1]); present.push(cell[0]); }
function localUnshift(values: V[], present: boolean[], value: V): number { values.push(undefined); present.push(false); for (let i = values.length - 1; i > 0; i--) { values[i] = values[i - 1]; present[i] = present[i - 1]; } values[0] = value; present[0] = true; return values.length; }
function relay<T>(xs: T[]): T[] { return xs; }
const target = relay<V>(items);
const result = localUnshift(target, present, 0);
const current: V[] = [], currentOwn: boolean[] = [];
for (let i = 0; i < target.length; i++) { current.push(present[i] ? target[i] : undefined); currentOwn.push(present[i]); }
assert.compareArray(current, [0, undefined, undefined, 3]);
assert.compareArray(currentOwn, [true, true, false, true]);
assert.sameValue(result, 4);
console.log("changing-unshift-stored:ok");
