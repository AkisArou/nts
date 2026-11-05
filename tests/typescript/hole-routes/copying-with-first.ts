/*---
description: "with(0, 9) changes the first element and fills the other hole with owned undefined."
features: [ts-hole-routes, ts-hole-route-copying, ts-arrays]
---*/

// with(0, 9) changes the first element and fills the other hole with owned undefined. Route: generic helper. Node prints copying-with-first:ok.
type V = number | undefined | number[];
const items: V[] = [1, , 3];
function relay<T>(data: T[]): T[] { return data; }
const target = relay<V>(items);
const result = target.with(0, 9);
const output = result; const own: boolean[] = []; for (let i = 0; i < output.length; i++) own.push(i in output);
const observedValues: V[] = []; for (let i = 0; i < output.length; i++) observedValues.push(output[i]);
assert.compareArray(observedValues, [9, undefined, 3]); assert.compareArray(own, [true, true, true]);
const sourceOwn: boolean[] = []; for (let i = 0; i < target.length; i++) sourceOwn.push(i in target);
assert.compareArray(sourceOwn, [true, false, true]);
console.log("copying-with-first:ok");
