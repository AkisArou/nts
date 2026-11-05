/*---
description: "toReversed returns [3, undefined, 1] and fills the original middle hole. (control)"
features: [ts-hole-routes, ts-hole-route-copying, ts-arrays]
---*/

// toReversed returns [3, undefined, 1] and fills the original middle hole. Route: guarded Map.get lookup. Node prints copying-to-reversed:ok.
type V = number | undefined | number[];
const items: V[] = []; const present: boolean[] = [];
const inputCells: readonly (readonly [boolean, V])[] = [[true, 1], [false, undefined], [true, 3]];
for (const cell of inputCells) { items.push(cell[1]); present.push(cell[0]); }
interface Copy { values: V[]; present: boolean[]; }
function localToReversed(xs: V[], own: boolean[]): Copy { const values: V[] = [], present: boolean[] = []; for (let i = xs.length - 1; i >= 0; i--) { values.push(own[i] ? xs[i] : undefined); present.push(true); } return { values, present }; }
const map = new Map<string, V[]>(); map.set("x", items);
const found = map.get("x"); if (found === undefined) throw new Error("missing"); const target = found;
const result = localToReversed(target, present);
const output = result.values; const own = result.present;
const observedValues: V[] = []; for (let i = 0; i < output.length; i++) observedValues.push(own[i] ? output[i] : undefined);
assert.compareArray(observedValues, [3, undefined, 1]); assert.compareArray(own, [true, true, true]);
const sourceOwn: boolean[] = []; for (let i = 0; i < target.length; i++) sourceOwn.push(present[i]);
assert.compareArray(sourceOwn, [true, false, true]);
console.log("copying-to-reversed:ok");
