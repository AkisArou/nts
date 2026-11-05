/*---
description: "slice(0, 2) preserves a leading hole and the following present value."
features: [ts-hole-routes, ts-hole-route-copying, ts-arrays]
---*/

// slice(0, 2) preserves a leading hole and the following present value. Route: generic helper. Node prints copying-slice-leading:ok.
type V = number | undefined | number[];
const items: V[] = [, 2, 3];
function relay<T>(data: T[]): T[] { return data; }
const target = relay<V>(items);
const result = target.slice(0, 2);
const output = result; const own: boolean[] = []; for (let i = 0; i < output.length; i++) own.push(i in output);
const observedValues: V[] = []; for (let i = 0; i < output.length; i++) observedValues.push(output[i]);
assert.compareArray(observedValues, [undefined, 2]); assert.compareArray(own, [false, true]);
const sourceOwn: boolean[] = []; for (let i = 0; i < target.length; i++) sourceOwn.push(i in target);
assert.compareArray(sourceOwn, [false, true, true]);
console.log("copying-slice-leading:ok");
