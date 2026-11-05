/*---
description: "concat preserves the absent indexes in both input arrays instead of filling them with undefined. (control)"
features: [ts-hole-routes, ts-hole-route-copying, ts-arrays]
---*/

// concat preserves the absent indexes in both input arrays instead of filling them with undefined. Route: guarded Map.get lookup. Node prints copying-concat-two:ok.
type V = number | undefined | number[];
const items: V[] = []; const present: boolean[] = [];
const inputCells: readonly (readonly [boolean, V])[] = [[true, 1], [false, undefined], [true, 3]];
for (const cell of inputCells) { items.push(cell[1]); present.push(cell[0]); }
interface Copy { values: V[]; present: boolean[]; }
function localConcat(xs: V[], own: boolean[], more: V[], moreOwn: boolean[]): Copy { const values: V[] = [], present: boolean[] = []; for (let i = 0; i < xs.length; i++) { values.push(own[i] ? xs[i] : undefined); present.push(own[i]); } for (let i = 0; i < more.length; i++) { values.push(moreOwn[i] ? more[i] : undefined); present.push(moreOwn[i]); } return { values, present }; }
const map = new Map<string, V[]>(); map.set("x", items);
const found = map.get("x"); if (found === undefined) throw new Error("missing"); const target = found;
const added: V[] = [4, undefined, 6]; const addedOwn = [true, false, true];
const result = localConcat(target, present, added, addedOwn);
const output = result.values; const own = result.present;
const observedValues: V[] = []; for (let i = 0; i < output.length; i++) observedValues.push(own[i] ? output[i] : undefined);
assert.compareArray(observedValues, [1, undefined, 3, 4, undefined, 6]); assert.compareArray(own, [true, false, true, true, false, true]);
const sourceOwn: boolean[] = []; for (let i = 0; i < target.length; i++) sourceOwn.push(present[i]);
assert.compareArray(sourceOwn, [true, false, true]);
console.log("copying-concat-two:ok");
