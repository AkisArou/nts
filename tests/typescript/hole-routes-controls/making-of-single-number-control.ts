/*---
description: "Array.of(3) stores one element, not three holes. (control)"
features: [ts-hole-routes, ts-hole-route-making, ts-arrays]
---*/

// Array.of(3) stores one element, not three holes. Route: captured closure. Node prints making-of-single-number:ok.
type V = number | string | undefined;
function localArrayArgs(values: V[], present: boolean[], argumentsList: readonly V[]): void { for (let i = 0; i < argumentsList.length; i++) { values.push(argumentsList[i]); present.push(true); } }
const items: V[] = []; const present: boolean[] = [];
localArrayArgs(items, present, [3]);
let captured: V[] = items; const readCaptured = (): V[] => captured;
const routed = readCaptured();
const actual: V[] = []; const observed: boolean[] = [];
for (let i = 0; i < routed.length; i++) { actual.push(present[i] ? routed[i] : undefined); observed.push(present[i]); }
assert.sameValue(routed.length, 1);
assert.compareArray(actual, [3]); assert.compareArray(observed, [true]);
console.log("making-of-single-number:ok");
