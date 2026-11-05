/*---
description: "Deleting an owned element preserves length and makes one hole. (control)"
features: [ts-hole-routes, ts-hole-route-making, ts-arrays]
---*/

// Deleting an owned element preserves length and makes one hole. Route: interface field. Node prints making-delete-middle-interface:ok.
type V = number | string | undefined;
function localElision(values: V[], present: boolean[], cells: readonly (readonly [boolean, V])[]): void { for (let i = 0; i < cells.length; i++) { values.push(cells[i][1]); present.push(cells[i][0]); } }
function localDelete(values: V[], present: boolean[], index: number): boolean { if (index < values.length) { values[index] = undefined; present[index] = false; } return true; }
const items: V[] = []; const present: boolean[] = [];
localElision(items, present, [[true, 1], [true, 2], [true, 3]]);
interface HoleCarrier { items: V[]; }
const carrier: HoleCarrier = { items }; const routed = carrier.items;
assert.sameValue(localDelete(routed, present, 1), true);
const actual: V[] = []; const observed: boolean[] = [];
for (let i = 0; i < routed.length; i++) { actual.push(present[i] ? routed[i] : undefined); observed.push(present[i]); }
assert.sameValue(routed.length, 3);
assert.compareArray(actual, [1, undefined, 3]); assert.compareArray(observed, [true, false, true]);
console.log("making-delete-middle-interface:ok");
