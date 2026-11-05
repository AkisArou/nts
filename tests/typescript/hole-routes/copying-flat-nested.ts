/*---
description: "flat(1) skips outer and nested holes and returns four owned numbers."
features: [ts-hole-routes, ts-hole-route-copying, ts-arrays]
---*/

// flat(1) skips outer and nested holes and returns four owned numbers. Route: generic helper. Node prints copying-flat-nested:ok.
type V = number | undefined | (number | undefined)[];
const items: V[] = [1, , 3, [4, , 6]];
function relay<T>(data: T[]): T[] { return data; }
const target = relay<V>(items);
const result = target.flat(1);
const output = result; const own: boolean[] = []; for (let i = 0; i < output.length; i++) own.push(i in output);
const observedValues: V[] = []; for (let i = 0; i < output.length; i++) observedValues.push(output[i]);
assert.compareArray(observedValues, [1, 3, 4, 6]); assert.compareArray(own, [true, true, true, true]);
const sourceOwn: boolean[] = []; for (let i = 0; i < target.length; i++) sourceOwn.push(i in target);
assert.compareArray(sourceOwn, [true, false, true, true]);
console.log("copying-flat-nested:ok");
