/*---
description: "Truncation destroys values so later regrowth yields holes."
features: [ts-hole-routes, ts-hole-route-making, ts-arrays]
---*/

// Truncation destroys values so later regrowth yields holes. Route: Map.get. Node prints making-length-truncate-regrow-map:ok.
type V = number | string | undefined;
const items: V[] = [1, 2, 3];
const bank = new Map<string, V[]>(); bank.set("entry", items);
const found = bank.get("entry"); if (found === undefined) throw new Error("missing"); const routed = found;
routed.length = 1; routed.length = 3;
const actual: V[] = []; const observed: boolean[] = [];
for (let i = 0; i < routed.length; i++) { actual.push(routed[i]); observed.push(i in routed); }
assert.sameValue(routed.length, 3);
assert.compareArray(actual, [1, undefined, undefined]); assert.compareArray(observed, [true, false, false]);
console.log("making-length-truncate-regrow-map:ok");
