/*---
description: "A negative array constructor length throws RangeError without creating indexes."
features: [ts-hole-routes, ts-hole-route-making, ts-arrays]
---*/

// A negative array constructor length throws RangeError without creating indexes. Route: discriminated union. Node prints making-constructor-negative-length:ok.
type V = number | string | undefined;
const items: V[] = [];
type Choice = { kind: "array"; items: V[] } | { kind: "other"; items: V[] };
const choice: Choice = { kind: "array", items }; const routed = choice.items;
assert.throws(RangeError, () => new Array<V>(-1));
const actual: V[] = []; const observed: boolean[] = [];
for (let i = 0; i < routed.length; i++) { actual.push(routed[i]); observed.push(i in routed); }
assert.sameValue(routed.length, 0);
assert.compareArray(actual, []); assert.compareArray(observed, []);
console.log("making-constructor-negative-length:ok");
