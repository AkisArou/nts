/*---
description: "Array.from fills the middle source hole with an owned undefined element. (control)"
features: [ts-hole-routes, ts-hole-route-copying, ts-arrays]
---*/

// Array.from fills the middle source hole with an owned undefined element. Route: interface field. Node prints copying-from-middle:ok.
type V = number | undefined | number[];
const items: V[] = []; const present: boolean[] = [];
const inputCells: readonly (readonly [boolean, V])[] = [[true, 1], [false, undefined], [true, 3]];
for (const cell of inputCells) { items.push(cell[1]); present.push(cell[0]); }
interface Copy { values: V[]; present: boolean[]; }
function localFrom(xs: V[], own: boolean[]): Copy { const values: V[] = [], present: boolean[] = []; for (let i = 0; i < xs.length; i++) { values.push(own[i] ? xs[i] : undefined); present.push(true); } return { values, present }; }
interface Holder { data: V[]; }
const holder: Holder = { data: items }; const target = holder.data;
const result = localFrom(target, present);
const output = result.values; const own = result.present;
const observedValues: V[] = []; for (let i = 0; i < output.length; i++) observedValues.push(own[i] ? output[i] : undefined);
assert.compareArray(observedValues, [1, undefined, 3]); assert.compareArray(own, [true, true, true]);
const sourceOwn: boolean[] = []; for (let i = 0; i < target.length; i++) sourceOwn.push(present[i]);
assert.compareArray(sourceOwn, [true, false, true]);
console.log("copying-from-middle:ok");
