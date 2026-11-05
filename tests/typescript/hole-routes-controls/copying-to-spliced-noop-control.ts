/*---
description: "toSpliced(0, 0) leaves the values in order but fills the middle hole. (control)"
features: [ts-hole-routes, ts-hole-route-copying, ts-arrays]
---*/

// toSpliced(0, 0) leaves the values in order but fills the middle hole. Route: readonly tuple row. Node prints copying-to-spliced-noop:ok.
type V = number | undefined | number[];
const items: V[] = []; const present: boolean[] = [];
const inputCells: readonly (readonly [boolean, V])[] = [[true, 1], [false, undefined], [true, 3]];
for (const cell of inputCells) { items.push(cell[1]); present.push(cell[0]); }
interface Copy { values: V[]; present: boolean[]; }
function localToSpliced(xs: V[], own: boolean[], start: number, count: number, insert?: V): Copy { const values: V[] = [], present: boolean[] = []; for (let i = 0; i < start; i++) { values.push(own[i] ? xs[i] : undefined); present.push(true); } if (insert !== undefined) { values.push(insert); present.push(true); } for (let i = start + count; i < xs.length; i++) { values.push(own[i] ? xs[i] : undefined); present.push(true); } return { values, present }; }
const rows: readonly [string, V[]][] = [["one", items]];
const target = rows[0][1];
const result = localToSpliced(target, present, 0, 0);
const output = result.values; const own = result.present;
const observedValues: V[] = []; for (let i = 0; i < output.length; i++) observedValues.push(own[i] ? output[i] : undefined);
assert.compareArray(observedValues, [1, undefined, 3]); assert.compareArray(own, [true, true, true]);
const sourceOwn: boolean[] = []; for (let i = 0; i < target.length; i++) sourceOwn.push(present[i]);
assert.compareArray(sourceOwn, [true, false, true]);
console.log("copying-to-spliced-noop:ok");
