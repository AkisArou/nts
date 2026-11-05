/*---
description: "Array.from fills missing arraylike indexes with owned undefined."
features: [ts-hole-routes, ts-hole-route-making, ts-arrays]
---*/

// Array.from fills missing arraylike indexes with owned undefined. Route: interface field. Node prints making-from-sparse-arraylike:ok.
type V = number | string | undefined;
const source: { length: number; [index: number]: V } = { length: 3, 0: "a", 2: "c" };
const items: V[] = Array.from(source);
interface HoleCarrier { items: V[]; }
const carrier: HoleCarrier = { items }; const routed = carrier.items;
const actual: V[] = []; const observed: boolean[] = [];
for (let i = 0; i < routed.length; i++) { actual.push(routed[i]); observed.push(i in routed); }
assert.sameValue(routed.length, 3);
assert.compareArray(actual, ["a", undefined, "c"]); assert.compareArray(observed, [true, true, true]);
console.log("making-from-sparse-arraylike:ok");
