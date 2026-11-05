/*---
description: "slice(1, 4) preserves two holes on either side of a present value."
features: [ts-hole-routes, ts-hole-route-copying, ts-arrays]
---*/

// slice(1, 4) preserves two holes on either side of a present value. Route: interface field. Node prints copying-slice-middle:ok.
type V = number | undefined | number[];
const items: V[] = [1, , 3, , 5];
interface Holder { data: V[]; }
const holder: Holder = { data: items }; const target = holder.data;
const result = target.slice(1, 4);
const output = result; const own: boolean[] = []; for (let i = 0; i < output.length; i++) own.push(i in output);
const observedValues: V[] = []; for (let i = 0; i < output.length; i++) observedValues.push(output[i]);
assert.compareArray(observedValues, [undefined, 3, undefined]); assert.compareArray(own, [false, true, false]);
const sourceOwn: boolean[] = []; for (let i = 0; i < target.length; i++) sourceOwn.push(i in target);
assert.compareArray(sourceOwn, [true, false, true, false, true]);
console.log("copying-slice-middle:ok");
