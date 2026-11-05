/*---
description: "A trailing comma after a value does not add a slot."
features: [ts-hole-routes, ts-hole-route-making, ts-arrays]
---*/

// A trailing comma after a value does not add a slot. Route: Map.get. Node prints making-elision-trailing-comma-map:ok.
type V = number | string | undefined;
const items: V[] = [1, 2,];
const bank = new Map<string, V[]>(); bank.set("entry", items);
const found = bank.get("entry"); if (found === undefined) throw new Error("missing"); const routed = found;
const actual: V[] = []; const observed: boolean[] = [];
for (let i = 0; i < routed.length; i++) { actual.push(routed[i]); observed.push(i in routed); }
assert.sameValue(routed.length, 2);
assert.compareArray(actual, [1, 2]); assert.compareArray(observed, [true, true]);
console.log("making-elision-trailing-comma-map:ok");
