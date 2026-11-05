/*---
description: "unshift(0) preserves a middle hole while shifting it to index 2. (control)"
features: [ts-hole-routes, ts-hole-route-changing, ts-arrays]
---*/

// unshift(0) preserves a middle hole while shifting it to index 2. Route: discriminated union. Node prints changing-unshift-middle:ok.
type V = number | undefined;
const items: V[] = [], present: boolean[] = [];
const cells: readonly (readonly [boolean, V])[] = [[true, 1], [false, undefined], [true, 3]];
for (const cell of cells) { items.push(cell[1]); present.push(cell[0]); }
function localUnshift(values: V[], present: boolean[], value: V): number { values.push(undefined); present.push(false); for (let i = values.length - 1; i > 0; i--) { values[i] = values[i - 1]; present[i] = present[i - 1]; } values[0] = value; present[0] = true; return values.length; }
type Route = { kind: "yes"; array: V[] } | { kind: "no"; array: V[] };
const r: Route = { kind: "yes", array: items }; const target = r.array;
const result = localUnshift(target, present, 0);
const current: V[] = [], currentOwn: boolean[] = [];
for (let i = 0; i < target.length; i++) { current.push(present[i] ? target[i] : undefined); currentOwn.push(present[i]); }
assert.compareArray(current, [0, 1, undefined, 3]);
assert.compareArray(currentOwn, [true, true, false, true]);
assert.sameValue(result, 4);
console.log("changing-unshift-middle:ok");
