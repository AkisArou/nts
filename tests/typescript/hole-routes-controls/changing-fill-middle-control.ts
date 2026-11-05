/*---
description: "fill(7, 1, 2) turns only the middle hole into a present number. (control)"
features: [ts-hole-routes, ts-hole-route-changing, ts-arrays]
---*/

// fill(7, 1, 2) turns only the middle hole into a present number. Route: interface field. Node prints changing-fill-middle:ok.
type V = number | undefined;
const items: V[] = [], present: boolean[] = [];
const cells: readonly (readonly [boolean, V])[] = [[true, 1], [false, undefined], [true, 3]];
for (const cell of cells) { items.push(cell[1]); present.push(cell[0]); }
function localFill(values: V[], present: boolean[], value: V, start: number = 0, end: number = values.length): V[] { for (let i = start; i < end; i++) { values[i] = value; present[i] = true; } return values; }
interface Carrier { values: V[]; }
const holder: Carrier = { values: items }; const target = holder.values;
const result = localFill(target, present, 7, 1, 2);
const current: V[] = [], currentOwn: boolean[] = [];
for (let i = 0; i < target.length; i++) { current.push(present[i] ? target[i] : undefined); currentOwn.push(present[i]); }
assert.compareArray(current, [1, 7, 3]);
assert.compareArray(currentOwn, [true, true, true]);
assert.sameValue(result, target);
console.log("changing-fill-middle:ok");
