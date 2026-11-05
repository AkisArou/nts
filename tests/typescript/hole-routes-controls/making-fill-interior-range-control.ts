/*---
description: "Filling an interior range leaves holes at both ends. (control)"
features: [ts-hole-routes, ts-hole-route-making, ts-arrays]
---*/

// Filling an interior range leaves holes at both ends. Route: Map.get. Node prints making-fill-interior-range:ok.
type V = number | string | undefined;
function localArrayLength(values: V[], present: boolean[], count: number): void { if (count < 0 || count % 1 !== 0 || count > 1000) throw new RangeError(); for (let i = 0; i < count; i++) { values.push(undefined); present.push(false); } }
function localFill(values: V[], present: boolean[], value: V, start: number, end: number): void { for (let i = start; i < end; i++) { values[i] = value; present[i] = true; } }
const items: V[] = []; const present: boolean[] = [];
localArrayLength(items, present, 4);
localFill(items, present, 7, 1, 3);
const bank = new Map<string, V[]>(); bank.set("entry", items);
const found = bank.get("entry"); if (found === undefined) throw new Error("missing"); const routed = found;
const actual: V[] = []; const observed: boolean[] = [];
for (let i = 0; i < routed.length; i++) { actual.push(present[i] ? routed[i] : undefined); observed.push(present[i]); }
assert.sameValue(routed.length, 4);
assert.compareArray(actual, [undefined, 7, 7, undefined]); assert.compareArray(observed, [false, true, true, false]);
console.log("making-fill-interior-range:ok");
