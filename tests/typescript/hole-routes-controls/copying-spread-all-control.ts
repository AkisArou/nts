/*---
description: "array spread converts two holes into two owned undefined values. (control)"
features: [ts-hole-routes, ts-hole-route-copying, ts-arrays]
---*/

// array spread converts two holes into two owned undefined values. Route: discriminated union. Node prints copying-spread-all:ok.
type V = number | undefined | number[];
const items: V[] = []; const present: boolean[] = [];
const inputCells: readonly (readonly [boolean, V])[] = [[false, undefined], [false, undefined]];
for (const cell of inputCells) { items.push(cell[1]); present.push(cell[0]); }
interface Copy { values: V[]; present: boolean[]; }
function localSpread(xs: V[], own: boolean[]): Copy { const values: V[] = [], present: boolean[] = []; for (let i = 0; i < xs.length; i++) { values.push(own[i] ? xs[i] : undefined); present.push(true); } return { values, present }; }
type Route = { tag: "array"; value: V[] } | { tag: "other"; value: V[] };
const entry: Route = { tag: "array", value: items }; const target = entry.value;
const result = localSpread(target, present);
const output = result.values; const own = result.present;
const observedValues: V[] = []; for (let i = 0; i < output.length; i++) observedValues.push(own[i] ? output[i] : undefined);
assert.compareArray(observedValues, [undefined, undefined]); assert.compareArray(own, [true, true]);
const sourceOwn: boolean[] = []; for (let i = 0; i < target.length; i++) sourceOwn.push(present[i]);
assert.compareArray(sourceOwn, [false, false]);
console.log("copying-spread-all:ok");
