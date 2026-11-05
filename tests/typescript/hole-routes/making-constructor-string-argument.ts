/*---
description: "A single string argument is an element, not an array length."
features: [ts-hole-routes, ts-hole-route-making, ts-arrays]
---*/

// A single string argument is an element, not an array length. Route: Map.get. Node prints making-constructor-string-argument:ok.
type V = number | string | undefined;
const items: V[] = new Array<V>("3");
const bank = new Map<string, V[]>(); bank.set("entry", items);
const found = bank.get("entry"); if (found === undefined) throw new Error("missing"); const routed = found;
const actual: V[] = []; const observed: boolean[] = [];
for (let i = 0; i < routed.length; i++) { actual.push(routed[i]); observed.push(i in routed); }
assert.sameValue(routed.length, 1);
assert.compareArray(actual, ["3"]); assert.compareArray(observed, [true]);
console.log("making-constructor-string-argument:ok");
