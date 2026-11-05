/*---
description: "flat(1) skips outer and nested holes and returns four owned numbers. (control)"
features: [ts-hole-routes, ts-hole-route-copying, ts-arrays]
---*/

// flat(1) skips outer and nested holes and returns four owned numbers. Route: generic helper. Node prints copying-flat-nested:ok.
type V = number | undefined | (number | undefined)[];
const items: V[] = []; const present: boolean[] = [];
const inputCells: readonly (readonly [boolean, V])[] = [[true, 1], [false, undefined], [true, 3], [true, [4, undefined, 6]]];
for (const cell of inputCells) { items.push(cell[1]); present.push(cell[0]); }
interface Copy { values: V[]; present: boolean[]; }
function localFlat(xs: V[], own: boolean[], depth: number, nestedOwn: readonly (readonly boolean[])[]): Copy { const values: V[] = [], present: boolean[] = []; for (let i = 0; i < xs.length; i++) if (own[i]) { const item = xs[i]; if (Array.isArray(item) && depth > 0) { for (let j = 0; j < item.length; j++) if (nestedOwn[i][j]) { values.push(item[j]); present.push(true); } } else { values.push(item); present.push(true); } } return { values, present }; }
function relay<T>(data: T[]): T[] { return data; }
const target = relay<V>(items);
const nestedOwn: readonly (readonly boolean[])[] = [[], [], [], [true, false, true]];
const result = localFlat(target, present, 1, nestedOwn);
const output = result.values; const own = result.present;
const observedValues: V[] = []; for (let i = 0; i < output.length; i++) observedValues.push(own[i] ? output[i] : undefined);
assert.compareArray(observedValues, [1, 3, 4, 6]); assert.compareArray(own, [true, true, true, true]);
const sourceOwn: boolean[] = []; for (let i = 0; i < target.length; i++) sourceOwn.push(present[i]);
assert.compareArray(sourceOwn, [true, false, true, true]);
console.log("copying-flat-nested:ok");
