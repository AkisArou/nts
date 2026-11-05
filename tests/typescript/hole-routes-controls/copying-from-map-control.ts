/*---
description: "Array.from's mapper visits a middle hole as undefined and produces a dense [10, 0, 30] copy. (control)"
features: [ts-hole-routes, ts-hole-route-copying, ts-arrays]
---*/

// Array.from's mapper visits a middle hole as undefined and produces a dense [10, 0, 30] copy. Route: private class field. Node prints copying-from-map:ok.
type V = number | undefined | number[];
const items: V[] = []; const present: boolean[] = [];
const inputCells: readonly (readonly [boolean, V])[] = [[true, 1], [false, undefined], [true, 3]];
for (const cell of inputCells) { items.push(cell[1]); present.push(cell[0]); }
interface Copy { values: V[]; present: boolean[]; }
function localFrom(xs: V[], own: boolean[], mapper: (value: V, index: number) => V): Copy { const values: V[] = [], present: boolean[] = []; for (let i = 0; i < xs.length; i++) { values.push(mapper(own[i] ? xs[i] : undefined, i)); present.push(true); } return { values, present }; }
class Shelf { #data: V[]; constructor(v: V[]) { this.#data = v; } get(): V[] { return this.#data; } }
const target = new Shelf(items).get();
const result = localFrom(target, present, (v, i) => v === undefined ? 0 : Number(v) * 10);
const output = result.values; const own = result.present;
const observedValues: V[] = []; for (let i = 0; i < output.length; i++) observedValues.push(own[i] ? output[i] : undefined);
assert.compareArray(observedValues, [10, 0, 30]); assert.compareArray(own, [true, true, true]);
const sourceOwn: boolean[] = []; for (let i = 0; i < target.length; i++) sourceOwn.push(present[i]);
assert.compareArray(sourceOwn, [true, false, true]);
console.log("copying-from-map:ok");
