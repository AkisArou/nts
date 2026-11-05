/*---
description: "with(1, 2) replaces the hole with a present number, yielding a dense copy. (control)"
features: [ts-hole-routes, ts-hole-route-copying, ts-arrays]
---*/

// with(1, 2) replaces the hole with a present number, yielding a dense copy. Route: private class field. Node prints copying-with-hole:ok.
type V = number | undefined | number[];
const items: V[] = []; const present: boolean[] = [];
const inputCells: readonly (readonly [boolean, V])[] = [[true, 1], [false, undefined], [true, 3]];
for (const cell of inputCells) { items.push(cell[1]); present.push(cell[0]); }
interface Copy { values: V[]; present: boolean[]; }
function localWith(xs: V[], own: boolean[], index: number, value: V): Copy { const values: V[] = [], present: boolean[] = []; for (let i = 0; i < xs.length; i++) { values.push(i === index ? value : own[i] ? xs[i] : undefined); present.push(true); } return { values, present }; }
class Shelf { #data: V[]; constructor(v: V[]) { this.#data = v; } get(): V[] { return this.#data; } }
const target = new Shelf(items).get();
const result = localWith(target, present, 1, 2);
const output = result.values; const own = result.present;
const observedValues: V[] = []; for (let i = 0; i < output.length; i++) observedValues.push(own[i] ? output[i] : undefined);
assert.compareArray(observedValues, [1, 2, 3]); assert.compareArray(own, [true, true, true]);
const sourceOwn: boolean[] = []; for (let i = 0; i < target.length; i++) sourceOwn.push(present[i]);
assert.compareArray(sourceOwn, [true, false, true]);
console.log("copying-with-hole:ok");
