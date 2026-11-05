/*---
description: "with(0, 9) changes the first element and fills the other hole with owned undefined. (control)"
features: [ts-hole-routes, ts-hole-route-copying, ts-arrays]
---*/

// with(0, 9) changes the first element and fills the other hole with owned undefined. Route: generic helper. Node prints copying-with-first:ok.
type V = number | undefined | number[];
const items: V[] = []; const present: boolean[] = [];
const inputCells: readonly (readonly [boolean, V])[] = [[true, 1], [false, undefined], [true, 3]];
for (const cell of inputCells) { items.push(cell[1]); present.push(cell[0]); }
interface Copy { values: V[]; present: boolean[]; }
function localWith(xs: V[], own: boolean[], index: number, value: V): Copy { const values: V[] = [], present: boolean[] = []; for (let i = 0; i < xs.length; i++) { values.push(i === index ? value : own[i] ? xs[i] : undefined); present.push(true); } return { values, present }; }
function relay<T>(data: T[]): T[] { return data; }
const target = relay<V>(items);
const result = localWith(target, present, 0, 9);
const output = result.values; const own = result.present;
const observedValues: V[] = []; for (let i = 0; i < output.length; i++) observedValues.push(own[i] ? output[i] : undefined);
assert.compareArray(observedValues, [9, undefined, 3]); assert.compareArray(own, [true, true, true]);
const sourceOwn: boolean[] = []; for (let i = 0; i < target.length; i++) sourceOwn.push(present[i]);
assert.compareArray(sourceOwn, [true, false, true]);
console.log("copying-with-first:ok");
