/*---
description: "flat(0) drops both absent positions and returns an empty dense array. (control)"
features: [ts-hole-routes, ts-hole-route-copying, ts-arrays]
---*/

// flat(0) drops both absent positions and returns an empty dense array. Route: captured closure. Node prints copying-flat-all-holes:ok.
type V = number | undefined | number[];
const items: V[] = []; const present: boolean[] = [];
const inputCells: readonly (readonly [boolean, V])[] = [[false, undefined], [false, undefined]];
for (const cell of inputCells) { items.push(cell[1]); present.push(cell[0]); }
interface Copy { values: V[]; present: boolean[]; }
function localFlat(xs: V[], own: boolean[], depth: number): Copy { const values: V[] = [], present: boolean[] = []; for (let i = 0; i < xs.length; i++) if (own[i]) { const item = xs[i]; if (Array.isArray(item) && depth > 0) { for (let j = 0; j < item.length; j++) if (j in item) { values.push(item[j]); present.push(true); } } else { values.push(item); present.push(true); } } return { values, present }; }
let current = items; const read = (): V[] => current; const target = read();
const result = localFlat(target, present, 0);
const output = result.values; const own = result.present;
const observedValues: V[] = []; for (let i = 0; i < output.length; i++) observedValues.push(own[i] ? output[i] : undefined);
assert.compareArray(observedValues, []); assert.compareArray(own, []);
const sourceOwn: boolean[] = []; for (let i = 0; i < target.length; i++) sourceOwn.push(present[i]);
assert.compareArray(sourceOwn, [false, false]);
console.log("copying-flat-all-holes:ok");
