/*---
description: "Two numeric constructor arguments are two owned elements. (control)"
features: [ts-hole-routes, ts-hole-route-making, ts-arrays]
---*/

// Two numeric constructor arguments are two owned elements. Route: captured closure. Node prints making-constructor-two-arguments:ok.
type V = number | string | undefined;
function localArrayArgs(values: V[], present: boolean[], argumentsList: readonly V[]): void { for (let i = 0; i < argumentsList.length; i++) { values.push(argumentsList[i]); present.push(true); } }
const items: V[] = []; const present: boolean[] = [];
localArrayArgs(items, present, [3, 4]);
let captured: V[] = items; const readCaptured = (): V[] => captured;
const routed = readCaptured();
const actual: V[] = []; const observed: boolean[] = [];
for (let i = 0; i < routed.length; i++) { actual.push(present[i] ? routed[i] : undefined); observed.push(present[i]); }
assert.sameValue(routed.length, 2);
assert.compareArray(actual, [3, 4]); assert.compareArray(observed, [true, true]);
console.log("making-constructor-two-arguments:ok");
