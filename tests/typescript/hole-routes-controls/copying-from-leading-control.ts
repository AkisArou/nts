/*---
description: "Array.from materializes a leading hole as an owned undefined in the copy. (control)"
features: [ts-hole-routes, ts-hole-route-copying, ts-arrays]
---*/

// Array.from materializes a leading hole as an owned undefined in the copy. Route: generic helper. Node prints copying-from-leading:ok.
type V = number | undefined | number[];
const items: V[] = []; const present: boolean[] = [];
const inputCells: readonly (readonly [boolean, V])[] = [[false, undefined], [true, 2]];
for (const cell of inputCells) { items.push(cell[1]); present.push(cell[0]); }
interface Copy { values: V[]; present: boolean[]; }
function localFrom(xs: V[], own: boolean[]): Copy { const values: V[] = [], present: boolean[] = []; for (let i = 0; i < xs.length; i++) { values.push(own[i] ? xs[i] : undefined); present.push(true); } return { values, present }; }
function relay<T>(data: T[]): T[] { return data; }
const target = relay<V>(items);
const result = localFrom(target, present);
const output = result.values; const own = result.present;
const observedValues: V[] = []; for (let i = 0; i < output.length; i++) observedValues.push(own[i] ? output[i] : undefined);
assert.compareArray(observedValues, [undefined, 2]); assert.compareArray(own, [true, true]);
const sourceOwn: boolean[] = []; for (let i = 0; i < target.length; i++) sourceOwn.push(present[i]);
assert.compareArray(sourceOwn, [false, true]);
console.log("copying-from-leading:ok");
