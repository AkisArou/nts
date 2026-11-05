/*---
description: "An elision between two values is absent although it reads undefined. (control)"
features: [ts-hole-routes, ts-hole-route-making, ts-arrays]
---*/

// An elision between two values is absent although it reads undefined. Route: interface field. Node prints making-elision-middle-interface:ok.
type V = number | string | undefined;
function localElision(values: V[], present: boolean[], cells: readonly (readonly [boolean, V])[]): void { for (let i = 0; i < cells.length; i++) { values.push(cells[i][1]); present.push(cells[i][0]); } }
const items: V[] = []; const present: boolean[] = [];
localElision(items, present, [[true, 1], [false, undefined], [true, 3]]);
interface HoleCarrier { items: V[]; }
const carrier: HoleCarrier = { items }; const routed = carrier.items;
const actual: V[] = []; const observed: boolean[] = [];
for (let i = 0; i < routed.length; i++) { actual.push(present[i] ? routed[i] : undefined); observed.push(present[i]); }
assert.sameValue(routed.length, 3);
assert.compareArray(actual, [1, undefined, 3]); assert.compareArray(observed, [true, false, true]);
console.log("making-elision-middle-interface:ok");
