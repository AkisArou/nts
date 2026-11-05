/*---
description: "A single string argument is an element, not an array length. (control)"
features: [ts-hole-routes, ts-hole-route-making, ts-arrays]
---*/

// A single string argument is an element, not an array length. Route: Map.get. Node prints making-constructor-string-argument:ok.
type V = number | string | undefined;
function localArrayArgs(values: V[], present: boolean[], argumentsList: readonly V[]): void { for (let i = 0; i < argumentsList.length; i++) { values.push(argumentsList[i]); present.push(true); } }
const items: V[] = []; const present: boolean[] = [];
localArrayArgs(items, present, ["3"]);
const bank = new Map<string, V[]>(); bank.set("entry", items);
const found = bank.get("entry"); if (found === undefined) throw new Error("missing"); const routed = found;
const actual: V[] = []; const observed: boolean[] = [];
for (let i = 0; i < routed.length; i++) { actual.push(present[i] ? routed[i] : undefined); observed.push(present[i]); }
assert.sameValue(routed.length, 1);
assert.compareArray(actual, ["3"]); assert.compareArray(observed, [true]);
console.log("making-constructor-string-argument:ok");
