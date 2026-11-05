/*---
description: "Array.from materializes a leading hole as an owned undefined in the copy."
features: [ts-hole-routes, ts-hole-route-copying, ts-arrays]
---*/

// Array.from materializes a leading hole as an owned undefined in the copy. Route: generic helper. Node prints copying-from-leading:ok.
type V = number | undefined | number[];
const items: V[] = [, 2];
function relay<T>(data: T[]): T[] { return data; }
const target = relay<V>(items);
const result = Array.from(target);
const output = result; const own: boolean[] = []; for (let i = 0; i < output.length; i++) own.push(i in output);
const observedValues: V[] = []; for (let i = 0; i < output.length; i++) observedValues.push(output[i]);
assert.compareArray(observedValues, [undefined, 2]); assert.compareArray(own, [true, true]);
const sourceOwn: boolean[] = []; for (let i = 0; i < target.length; i++) sourceOwn.push(i in target);
assert.compareArray(sourceOwn, [false, true]);
console.log("copying-from-leading:ok");
