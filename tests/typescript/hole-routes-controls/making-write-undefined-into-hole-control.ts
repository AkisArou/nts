/*---
description: "Writing undefined into an absent slot makes it present. (control)"
features: [ts-hole-routes, ts-hole-route-making, ts-arrays]
---*/

// Writing undefined into an absent slot makes it present. Route: interface field. Node prints making-write-undefined-into-hole:ok.
type V = number | string | undefined;
function localElision(values: V[], present: boolean[], cells: readonly (readonly [boolean, V])[]): void { for (let i = 0; i < cells.length; i++) { values.push(cells[i][1]); present.push(cells[i][0]); } }
function localWrite(values: V[], present: boolean[], index: number, value: V): void { while (values.length <= index) { values.push(undefined); present.push(false); } values[index] = value; present[index] = true; }
const items: V[] = []; const present: boolean[] = [];
localElision(items, present, [[true, 1], [false, undefined], [true, 3]]);
interface HoleCarrier { items: V[]; }
const carrier: HoleCarrier = { items }; const routed = carrier.items;
localWrite(routed, present, 1, undefined);
const actual: V[] = []; const observed: boolean[] = [];
for (let i = 0; i < routed.length; i++) { actual.push(present[i] ? routed[i] : undefined); observed.push(present[i]); }
assert.sameValue(routed.length, 3);
assert.compareArray(actual, [1, undefined, 3]); assert.compareArray(observed, [true, true, true]);
console.log("making-write-undefined-into-hole:ok");
