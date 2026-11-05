/*---
description: "reduceRight over one present value returns 5 without invoking the callback."
features: [ts-hole-routes, ts-hole-route-visiting, ts-arrays]
---*/

// reduceRight over one present value returns 5 without invoking the callback. Route: captured closure. Node prints visiting-reduce-right-single:ok.
type V = number | undefined;
const items: V[] = [, 5, ,];
let captured = items; function takeCaptured(): V[] { return captured; }
const target = takeCaptured();
const visits: number[] = [];
const result = target.reduceRight((sum, value, index) => { visits.push(index); return (sum ?? 0) + (value ?? 0); });
assert.sameValue(result, 5); assert.compareArray(visits, []);
const presence: boolean[] = []; for (let i = 0; i < target.length; i++) presence.push(i in target);
assert.compareArray(presence, [false, true, false]);
console.log("visiting-reduce-right-single:ok");
