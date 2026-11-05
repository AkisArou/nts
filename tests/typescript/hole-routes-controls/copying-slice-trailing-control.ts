/*---
description: "slice(1, 3) retains the trailing hole rather than making an owned undefined. (control)"
features: [ts-hole-routes, ts-hole-route-copying, ts-arrays]
---*/

// slice(1, 3) retains the trailing hole rather than making an owned undefined. Route: private class field. Node prints copying-slice-trailing:ok.
type V = number | undefined | number[];
const items: V[] = []; const present: boolean[] = [];
const inputCells: readonly (readonly [boolean, V])[] = [[true, 1], [true, 2], [false, undefined]];
for (const cell of inputCells) { items.push(cell[1]); present.push(cell[0]); }
interface Copy { values: V[]; present: boolean[]; }
function localSlice(xs: V[], own: boolean[], start: number, end: number): Copy { const values: V[] = [], present: boolean[] = []; for (let i = start; i < end && i < xs.length; i++) { values.push(own[i] ? xs[i] : undefined); present.push(own[i]); } return { values, present }; }
class Shelf { #data: V[]; constructor(v: V[]) { this.#data = v; } get(): V[] { return this.#data; } }
const target = new Shelf(items).get();
const result = localSlice(target, present, 1, 3);
const output = result.values; const own = result.present;
const observedValues: V[] = []; for (let i = 0; i < output.length; i++) observedValues.push(own[i] ? output[i] : undefined);
assert.compareArray(observedValues, [2, undefined]); assert.compareArray(own, [true, false]);
const sourceOwn: boolean[] = []; for (let i = 0; i < target.length; i++) sourceOwn.push(present[i]);
assert.compareArray(sourceOwn, [true, true, false]);
console.log("copying-slice-trailing:ok");
