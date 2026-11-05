/*---
description: "concat retains the leading source hole and the hole in its second array at the original offsets. (control)"
features: [ts-hole-routes, ts-hole-route-copying, ts-arrays]
---*/

// concat retains the leading source hole and the hole in its second array at the original offsets. Route: captured closure. Node prints copying-concat-leading:ok.
type V = number | undefined | number[];
const items: V[] = []; const present: boolean[] = [];
const inputCells: readonly (readonly [boolean, V])[] = [[false, undefined], [true, 2]];
for (const cell of inputCells) { items.push(cell[1]); present.push(cell[0]); }
interface Copy { values: V[]; present: boolean[]; }
function localConcat(xs: V[], own: boolean[], more: V[], moreOwn: boolean[]): Copy { const values: V[] = [], present: boolean[] = []; for (let i = 0; i < xs.length; i++) { values.push(own[i] ? xs[i] : undefined); present.push(own[i]); } for (let i = 0; i < more.length; i++) { values.push(moreOwn[i] ? more[i] : undefined); present.push(moreOwn[i]); } return { values, present }; }
let current = items; const read = (): V[] => current; const target = read();
const added: V[] = [4, undefined, 6]; const addedOwn = [true, false, true];
const result = localConcat(target, present, added, addedOwn);
const output = result.values; const own = result.present;
const observedValues: V[] = []; for (let i = 0; i < output.length; i++) observedValues.push(own[i] ? output[i] : undefined);
assert.compareArray(observedValues, [undefined, 2, 4, undefined, 6]); assert.compareArray(own, [false, true, true, false, true]);
const sourceOwn: boolean[] = []; for (let i = 0; i < target.length; i++) sourceOwn.push(present[i]);
assert.compareArray(sourceOwn, [false, true]);
console.log("copying-concat-leading:ok");
