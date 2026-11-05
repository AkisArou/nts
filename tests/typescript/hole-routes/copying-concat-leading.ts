/*---
description: "concat retains the leading source hole and the hole in its second array at the original offsets."
features: [ts-hole-routes, ts-hole-route-copying, ts-arrays]
---*/

// concat retains the leading source hole and the hole in its second array at the original offsets. Route: captured closure. Node prints copying-concat-leading:ok.
type V = number | undefined | number[];
const items: V[] = [, 2];
let current = items; const read = (): V[] => current; const target = read();
const result = target.concat([4, , 6]);
const output = result; const own: boolean[] = []; for (let i = 0; i < output.length; i++) own.push(i in output);
const observedValues: V[] = []; for (let i = 0; i < output.length; i++) observedValues.push(output[i]);
assert.compareArray(observedValues, [undefined, 2, 4, undefined, 6]); assert.compareArray(own, [false, true, true, false, true]);
const sourceOwn: boolean[] = []; for (let i = 0; i < target.length; i++) sourceOwn.push(i in target);
assert.compareArray(sourceOwn, [false, true]);
console.log("copying-concat-leading:ok");
