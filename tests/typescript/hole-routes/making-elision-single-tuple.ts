/*---
description: "A one-comma literal has exactly one hole."
features: [ts-hole-routes, ts-hole-route-making, ts-arrays]
---*/

// A one-comma literal has exactly one hole. Route: discriminated union. Node prints making-elision-single-tuple:ok.
type V = number | string | undefined;
const items: V[] = [,];
type Choice = { kind: "array"; items: V[] } | { kind: "other"; items: V[] };
const choice: Choice = { kind: "array", items }; const routed = choice.items;
const actual: V[] = []; const observed: boolean[] = [];
for (let i = 0; i < routed.length; i++) { actual.push(routed[i]); observed.push(i in routed); }
assert.sameValue(routed.length, 1);
assert.compareArray(actual, [undefined]); assert.compareArray(observed, [false]);
console.log("making-elision-single-tuple:ok");
