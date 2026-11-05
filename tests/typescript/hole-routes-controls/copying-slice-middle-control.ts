/*---
description: "slice(1, 4) preserves two holes on either side of a present value. (control)"
features: [ts-hole-routes, ts-hole-route-copying, ts-arrays]
---*/

// slice(1, 4) preserves two holes on either side of a present value. Route: interface field. Node prints copying-slice-middle:ok.
type V = number | undefined | number[];
const items: V[] = []; const present: boolean[] = [];
const inputCells: readonly (readonly [boolean, V])[] = [[true, 1], [false, undefined], [true, 3], [false, undefined], [true, 5]];
for (const cell of inputCells) { items.push(cell[1]); present.push(cell[0]); }
interface Copy { values: V[]; present: boolean[]; }
function localSlice(xs: V[], own: boolean[], start: number, end: number): Copy { const values: V[] = [], present: boolean[] = []; for (let i = start; i < end && i < xs.length; i++) { values.push(own[i] ? xs[i] : undefined); present.push(own[i]); } return { values, present }; }
interface Holder { data: V[]; }
const holder: Holder = { data: items }; const target = holder.data;
const result = localSlice(target, present, 1, 4);
const output = result.values; const own = result.present;
const observedValues: V[] = []; for (let i = 0; i < output.length; i++) observedValues.push(own[i] ? output[i] : undefined);
assert.compareArray(observedValues, [undefined, 3, undefined]); assert.compareArray(own, [false, true, false]);
const sourceOwn: boolean[] = []; for (let i = 0; i < target.length; i++) sourceOwn.push(present[i]);
assert.compareArray(sourceOwn, [true, false, true, false, true]);
console.log("copying-slice-middle:ok");
