/*---
description: "toSpliced(0, 1) removes the first value and materializes the shifted hole as undefined."
features: [ts-hole-routes, ts-hole-route-copying, ts-arrays]
---*/

// toSpliced(0, 1) removes the first value and materializes the shifted hole as undefined. Route: interface field. Node prints copying-to-spliced-remove:ok.
type V = number | undefined | number[];
const items: V[] = [1, , 3];
interface Holder { data: V[]; }
const holder: Holder = { data: items }; const target = holder.data;
const result = target.toSpliced(0, 1);
const output = result; const own: boolean[] = []; for (let i = 0; i < output.length; i++) own.push(i in output);
const observedValues: V[] = []; for (let i = 0; i < output.length; i++) observedValues.push(output[i]);
assert.compareArray(observedValues, [undefined, 3]); assert.compareArray(own, [true, true]);
const sourceOwn: boolean[] = []; for (let i = 0; i < target.length; i++) sourceOwn.push(i in target);
assert.compareArray(sourceOwn, [true, false, true]);
console.log("copying-to-spliced-remove:ok");
