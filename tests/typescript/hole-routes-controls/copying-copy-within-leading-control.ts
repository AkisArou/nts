/*---
description: "copyWithin(2, 0, 2) moves a leading hole to index 2 while copying the next value to index 3. (control)"
features: [ts-hole-routes, ts-hole-route-copying, ts-arrays]
---*/

// copyWithin(2, 0, 2) moves a leading hole to index 2 while copying the next value to index 3. Route: interface field. Node prints copying-copy-within-leading:ok.
type V = number | undefined | number[];
const items: V[] = []; const present: boolean[] = [];
const inputCells: readonly (readonly [boolean, V])[] = [[false, undefined], [true, 2], [true, 3], [true, 4]];
for (const cell of inputCells) { items.push(cell[1]); present.push(cell[0]); }
interface Copy { values: V[]; present: boolean[]; }
function localCopyWithin(xs: V[], own: boolean[], to: number, start: number, end: number): Copy { const saved: V[] = [], flags: boolean[] = []; for (let i = start; i < end; i++) { saved.push(own[i] ? xs[i] : undefined); flags.push(own[i]); } for (let i = 0; i < saved.length && to + i < xs.length; i++) { xs[to + i] = saved[i]; own[to + i] = flags[i]; } return { values: xs, present: own }; }
interface Holder { data: V[]; }
const holder: Holder = { data: items }; const target = holder.data;
const result = localCopyWithin(target, present, 2, 0, 2);
const output = result.values; const own = result.present;
const observedValues: V[] = []; for (let i = 0; i < output.length; i++) observedValues.push(own[i] ? output[i] : undefined);
assert.compareArray(observedValues, [undefined, 2, undefined, 2]); assert.compareArray(own, [false, true, false, true]);
assert.sameValue(output === target, true);
console.log("copying-copy-within-leading:ok");
