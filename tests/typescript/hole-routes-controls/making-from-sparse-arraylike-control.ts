/*---
description: "Array.from fills missing arraylike indexes with owned undefined. (control)"
features: [ts-hole-routes, ts-hole-route-making, ts-arrays]
---*/

// Array.from fills missing arraylike indexes with owned undefined. Route: interface field. Node prints making-from-sparse-arraylike:ok.
type V = number | string | undefined;
function localFrom(values: V[], present: boolean[], input: readonly V[], inputPresent: readonly boolean[]): void { for (let i = 0; i < input.length; i++) { values.push(inputPresent[i] ? input[i] : undefined); present.push(true); } }
function localElision(values: V[], present: boolean[], cells: readonly (readonly [boolean, V])[]): void { for (let i = 0; i < cells.length; i++) { values.push(cells[i][1]); present.push(cells[i][0]); } }
const items: V[] = []; const present: boolean[] = [];
const sourceValues: V[] = []; const sourcePresent: boolean[] = [];
localElision(sourceValues, sourcePresent, [[true, "a"], [false, undefined], [true, "c"]]);
localFrom(items, present, sourceValues, sourcePresent);
interface HoleCarrier { items: V[]; }
const carrier: HoleCarrier = { items }; const routed = carrier.items;
const actual: V[] = []; const observed: boolean[] = [];
for (let i = 0; i < routed.length; i++) { actual.push(present[i] ? routed[i] : undefined); observed.push(present[i]); }
assert.sameValue(routed.length, 3);
assert.compareArray(actual, ["a", undefined, "c"]); assert.compareArray(observed, [true, true, true]);
console.log("making-from-sparse-arraylike:ok");
