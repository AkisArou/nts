/*---
description: "Array.from on a length-only object creates owned undefined slots. (control)"
features: [ts-hole-routes, ts-hole-route-making, ts-arrays]
---*/

// Array.from on a length-only object creates owned undefined slots. Route: readonly tuple rows. Node prints making-from-arraylike-length:ok.
type V = unknown;
function localFrom(values: V[], present: boolean[], input: readonly V[], inputPresent: readonly boolean[]): void { for (let i = 0; i < input.length; i++) { values.push(inputPresent[i] ? input[i] : undefined); present.push(true); } }
function localElision(values: V[], present: boolean[], cells: readonly (readonly [boolean, V])[]): void { for (let i = 0; i < cells.length; i++) { values.push(cells[i][1]); present.push(cells[i][0]); } }
const items: V[] = []; const present: boolean[] = [];
const sourceValues: V[] = []; const sourcePresent: boolean[] = [];
localElision(sourceValues, sourcePresent, [[false, undefined], [false, undefined], [false, undefined]]);
localFrom(items, present, sourceValues, sourcePresent);
const rows: readonly [string, V[]][] = [["first", items]];
const routed = rows[0][1];
const actual: V[] = []; const observed: boolean[] = [];
for (let i = 0; i < routed.length; i++) { actual.push(present[i] ? routed[i] : undefined); observed.push(present[i]); }
assert.sameValue(routed.length, 3);
assert.compareArray(actual, [undefined, undefined, undefined]); assert.compareArray(observed, [true, true, true]);
console.log("making-from-arraylike-length:ok");
