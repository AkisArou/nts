/*---
description: "copyWithin(2, 0, 2) copies a source hole into index 3 as a hole and a number into index 2. (control)"
features: [ts-hole-routes, ts-hole-route-copying, ts-arrays]
---*/

// copyWithin(2, 0, 2) copies a source hole into index 3 as a hole and a number into index 2. Route: readonly tuple row. Node prints copying-copy-within-hole:ok.
type V = number | undefined | number[];
const items: V[] = []; const present: boolean[] = [];
const inputCells: readonly (readonly [boolean, V])[] = [[true, 1], [false, undefined], [true, 3], [true, 4]];
for (const cell of inputCells) { items.push(cell[1]); present.push(cell[0]); }
interface Copy { values: V[]; present: boolean[]; }
function localCopyWithin(xs: V[], own: boolean[], to: number, start: number, end: number): Copy { const saved: V[] = [], flags: boolean[] = []; for (let i = start; i < end; i++) { saved.push(own[i] ? xs[i] : undefined); flags.push(own[i]); } for (let i = 0; i < saved.length && to + i < xs.length; i++) { xs[to + i] = saved[i]; own[to + i] = flags[i]; } return { values: xs, present: own }; }
const rows: readonly [string, V[]][] = [["one", items]];
const target = rows[0][1];
const result = localCopyWithin(target, present, 2, 0, 2);
const output = result.values; const own = result.present;
const observedValues: V[] = []; for (let i = 0; i < output.length; i++) observedValues.push(own[i] ? output[i] : undefined);
assert.compareArray(observedValues, [1, undefined, 1, undefined]); assert.compareArray(own, [true, false, true, false]);
assert.sameValue(output === target, true);
console.log("copying-copy-within-hole:ok");
