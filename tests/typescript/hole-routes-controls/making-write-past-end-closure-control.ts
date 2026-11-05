/*---
description: "Writing past the end leaves intervening indexes absent. (control)"
features: [ts-hole-routes, ts-hole-route-making, ts-arrays]
---*/

// Writing past the end leaves intervening indexes absent. Route: captured closure. Node prints making-write-past-end-closure:ok.
type V = number | string | undefined;
function localElision(values: V[], present: boolean[], cells: readonly (readonly [boolean, V])[]): void { for (let i = 0; i < cells.length; i++) { values.push(cells[i][1]); present.push(cells[i][0]); } }
function localWrite(values: V[], present: boolean[], index: number, value: V): void { while (values.length <= index) { values.push(undefined); present.push(false); } values[index] = value; present[index] = true; }
const items: V[] = []; const present: boolean[] = [];
localElision(items, present, [[true, 1]]);
let captured: V[] = items; const readCaptured = (): V[] => captured;
const routed = readCaptured();
localWrite(routed, present, 4, 5);
const actual: V[] = []; const observed: boolean[] = [];
for (let i = 0; i < routed.length; i++) { actual.push(present[i] ? routed[i] : undefined); observed.push(present[i]); }
assert.sameValue(routed.length, 5);
assert.compareArray(actual, [1, undefined, undefined, undefined, 5]); assert.compareArray(observed, [true, false, false, false, true]);
console.log("making-write-past-end-closure:ok");
