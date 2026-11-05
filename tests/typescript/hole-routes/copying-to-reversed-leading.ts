/*---
description: "toReversed places a leading hole at the end as an owned undefined."
features: [ts-hole-routes, ts-hole-route-copying, ts-arrays]
---*/

// toReversed places a leading hole at the end as an owned undefined. Route: captured closure. Node prints copying-to-reversed-leading:ok.
type V = number | undefined | number[];
const items: V[] = [, 2, 3];
let current = items; const read = (): V[] => current; const target = read();
const result = target.toReversed();
const output = result; const own: boolean[] = []; for (let i = 0; i < output.length; i++) own.push(i in output);
const observedValues: V[] = []; for (let i = 0; i < output.length; i++) observedValues.push(output[i]);
assert.compareArray(observedValues, [3, 2, undefined]); assert.compareArray(own, [true, true, true]);
const sourceOwn: boolean[] = []; for (let i = 0; i < target.length; i++) sourceOwn.push(i in target);
assert.compareArray(sourceOwn, [false, true, true]);
console.log("copying-to-reversed-leading:ok");
