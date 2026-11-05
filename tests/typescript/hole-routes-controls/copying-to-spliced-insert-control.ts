/*---
description: "toSpliced(1, 0, 9) inserts 9 and turns the shifted hole into an owned undefined. (control)"
features: [ts-hole-routes, ts-hole-route-copying, ts-arrays]
---*/

// toSpliced(1, 0, 9) inserts 9 and turns the shifted hole into an owned undefined. Route: discriminated union. Node prints copying-to-spliced-insert:ok.
type V = number | undefined | number[];
const items: V[] = []; const present: boolean[] = [];
const inputCells: readonly (readonly [boolean, V])[] = [[true, 1], [false, undefined], [true, 3]];
for (const cell of inputCells) { items.push(cell[1]); present.push(cell[0]); }
interface Copy { values: V[]; present: boolean[]; }
function localToSpliced(xs: V[], own: boolean[], start: number, count: number, insert?: V): Copy { const values: V[] = [], present: boolean[] = []; for (let i = 0; i < start; i++) { values.push(own[i] ? xs[i] : undefined); present.push(true); } if (insert !== undefined) { values.push(insert); present.push(true); } for (let i = start + count; i < xs.length; i++) { values.push(own[i] ? xs[i] : undefined); present.push(true); } return { values, present }; }
type Route = { tag: "array"; value: V[] } | { tag: "other"; value: V[] };
const entry: Route = { tag: "array", value: items }; const target = entry.value;
const result = localToSpliced(target, present, 1, 0, 9);
const output = result.values; const own = result.present;
const observedValues: V[] = []; for (let i = 0; i < output.length; i++) observedValues.push(own[i] ? output[i] : undefined);
assert.compareArray(observedValues, [1, 9, undefined, 3]); assert.compareArray(own, [true, true, true, true]);
const sourceOwn: boolean[] = []; for (let i = 0; i < target.length; i++) sourceOwn.push(present[i]);
assert.compareArray(sourceOwn, [true, false, true]);
console.log("copying-to-spliced-insert:ok");
