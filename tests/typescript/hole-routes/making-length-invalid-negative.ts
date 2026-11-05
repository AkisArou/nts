/*---
description: "Assigning negative length throws without mutating an array."
features: [ts-hole-routes, ts-hole-route-making, ts-arrays]
---*/

// Assigning negative length throws without mutating an array. Route: discriminated union. Node prints making-length-invalid-negative:ok.
type V = number | string | undefined;
const items: V[] = [1, 2, 3];
type Choice = { kind: "array"; items: V[] } | { kind: "other"; items: V[] };
const choice: Choice = { kind: "array", items }; const routed = choice.items;
assert.throws(RangeError, () => { routed.length = -1; });
const actual: V[] = []; const observed: boolean[] = [];
for (let i = 0; i < routed.length; i++) { actual.push(routed[i]); observed.push(i in routed); }
assert.sameValue(routed.length, 3);
assert.compareArray(actual, [1, 2, 3]); assert.compareArray(observed, [true, true, true]);
console.log("making-length-invalid-negative:ok");
