/*---
description: "reduce over one present value returns 5 without invoking the callback."
features: [ts-hole-routes, ts-hole-route-visiting, ts-arrays]
---*/

// reduce over one present value returns 5 without invoking the callback. Route: interface array holder. Node prints visiting-reduce-single-present:ok.
type V = number | undefined;
const items: V[] = [, 5, ,];
interface Carrier { data: V[]; }
const carrier: Carrier = { data: items }; const target = carrier.data;
const visits: number[] = [];
const result = target.reduce((sum, value, index) => { visits.push(index); return (sum ?? 0) + (value ?? 0); });
assert.sameValue(result, 5); assert.compareArray(visits, []);
const presence: boolean[] = []; for (let i = 0; i < target.length; i++) presence.push(i in target);
assert.compareArray(presence, [false, true, false]);
console.log("visiting-reduce-single-present:ok");
