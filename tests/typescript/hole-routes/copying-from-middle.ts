/*---
description: "Array.from fills the middle source hole with an owned undefined element."
features: [ts-hole-routes, ts-hole-route-copying, ts-arrays]
---*/

// Array.from fills the middle source hole with an owned undefined element. Route: interface field. Node prints copying-from-middle:ok.
type V = number | undefined | number[];
const items: V[] = [1, , 3];
interface Holder { data: V[]; }
const holder: Holder = { data: items }; const target = holder.data;
const result = Array.from(target);
const output = result; const own: boolean[] = []; for (let i = 0; i < output.length; i++) own.push(i in output);
const observedValues: V[] = []; for (let i = 0; i < output.length; i++) observedValues.push(output[i]);
assert.compareArray(observedValues, [1, undefined, 3]); assert.compareArray(own, [true, true, true]);
const sourceOwn: boolean[] = []; for (let i = 0; i < target.length; i++) sourceOwn.push(i in target);
assert.compareArray(sourceOwn, [true, false, true]);
console.log("copying-from-middle:ok");
