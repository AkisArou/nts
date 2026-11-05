/*---
description: "Filling an interior range leaves holes at both ends."
features: [ts-hole-routes, ts-hole-route-making, ts-arrays]
---*/

// Filling an interior range leaves holes at both ends. Route: Map.get. Node prints making-fill-interior-range:ok.
type V = number | string | undefined;
const items: V[] = new Array<V>(4).fill(7, 1, 3);
const bank = new Map<string, V[]>(); bank.set("entry", items);
const found = bank.get("entry"); if (found === undefined) throw new Error("missing"); const routed = found;
const actual: V[] = []; const observed: boolean[] = [];
for (let i = 0; i < routed.length; i++) { actual.push(routed[i]); observed.push(i in routed); }
assert.sameValue(routed.length, 4);
assert.compareArray(actual, [undefined, 7, 7, undefined]); assert.compareArray(observed, [false, true, true, false]);
console.log("making-fill-interior-range:ok");
