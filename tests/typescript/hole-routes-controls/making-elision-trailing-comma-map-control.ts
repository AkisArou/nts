/*---
description: "A trailing comma after a value does not add a slot. (control)"
features: [ts-hole-routes, ts-hole-route-making, ts-arrays]
---*/

// A trailing comma after a value does not add a slot. Route: Map.get. Node prints making-elision-trailing-comma-map:ok.
type V = number | string | undefined;
function localElision(values: V[], present: boolean[], cells: readonly (readonly [boolean, V])[]): void { for (let i = 0; i < cells.length; i++) { values.push(cells[i][1]); present.push(cells[i][0]); } }
const items: V[] = []; const present: boolean[] = [];
localElision(items, present, [[true, 1], [true, 2]]);
const bank = new Map<string, V[]>(); bank.set("entry", items);
const found = bank.get("entry"); if (found === undefined) throw new Error("missing"); const routed = found;
const actual: V[] = []; const observed: boolean[] = [];
for (let i = 0; i < routed.length; i++) { actual.push(present[i] ? routed[i] : undefined); observed.push(present[i]); }
assert.sameValue(routed.length, 2);
assert.compareArray(actual, [1, 2]); assert.compareArray(observed, [true, true]);
console.log("making-elision-trailing-comma-map:ok");
