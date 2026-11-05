/*---
description: "A trailing comma after an elision preserves that one hole. (control)"
features: [ts-hole-routes, ts-hole-route-making, ts-arrays]
---*/

// A trailing comma after an elision preserves that one hole. Route: captured closure. Node prints making-elision-trailing-hole-closure:ok.
type V = number | string | undefined;
function localElision(values: V[], present: boolean[], cells: readonly (readonly [boolean, V])[]): void { for (let i = 0; i < cells.length; i++) { values.push(cells[i][1]); present.push(cells[i][0]); } }
const items: V[] = []; const present: boolean[] = [];
localElision(items, present, [[true, 1], [false, undefined]]);
let captured: V[] = items; const readCaptured = (): V[] => captured;
const routed = readCaptured();
const actual: V[] = []; const observed: boolean[] = [];
for (let i = 0; i < routed.length; i++) { actual.push(present[i] ? routed[i] : undefined); observed.push(present[i]); }
assert.sameValue(routed.length, 2);
assert.compareArray(actual, [1, undefined]); assert.compareArray(observed, [true, false]);
console.log("making-elision-trailing-hole-closure:ok");
