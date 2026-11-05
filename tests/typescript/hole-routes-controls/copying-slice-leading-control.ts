/*---
description: "slice(0, 2) preserves a leading hole and the following present value. (control)"
features: [ts-hole-routes, ts-hole-route-copying, ts-arrays]
---*/

// slice(0, 2) preserves a leading hole and the following present value. Route: generic helper. Node prints copying-slice-leading:ok.
type V = number | undefined | number[];
const items: V[] = []; const present: boolean[] = [];
const inputCells: readonly (readonly [boolean, V])[] = [[false, undefined], [true, 2], [true, 3]];
for (const cell of inputCells) { items.push(cell[1]); present.push(cell[0]); }
interface Copy { values: V[]; present: boolean[]; }
function localSlice(xs: V[], own: boolean[], start: number, end: number): Copy { const values: V[] = [], present: boolean[] = []; for (let i = start; i < end && i < xs.length; i++) { values.push(own[i] ? xs[i] : undefined); present.push(own[i]); } return { values, present }; }
function relay<T>(data: T[]): T[] { return data; }
const target = relay<V>(items);
const result = localSlice(target, present, 0, 2);
const output = result.values; const own = result.present;
const observedValues: V[] = []; for (let i = 0; i < output.length; i++) observedValues.push(own[i] ? output[i] : undefined);
assert.compareArray(observedValues, [undefined, 2]); assert.compareArray(own, [false, true]);
const sourceOwn: boolean[] = []; for (let i = 0; i < target.length; i++) sourceOwn.push(present[i]);
assert.compareArray(sourceOwn, [false, true, true]);
console.log("copying-slice-leading:ok");
