/*---
description: "copyWithin(2, 0, 2) moves a leading hole to index 2 while copying the next value to index 3."
features: [ts-hole-routes, ts-hole-route-copying, ts-arrays]
---*/

// copyWithin(2, 0, 2) moves a leading hole to index 2 while copying the next value to index 3. Route: interface field. Node prints copying-copy-within-leading:ok.
type V = number | undefined | number[];
const items: V[] = [, 2, 3, 4];
interface Holder { data: V[]; }
const holder: Holder = { data: items }; const target = holder.data;
const result = target.copyWithin(2, 0, 2);
const output = result; const own: boolean[] = []; for (let i = 0; i < output.length; i++) own.push(i in output);
const observedValues: V[] = []; for (let i = 0; i < output.length; i++) observedValues.push(output[i]);
assert.compareArray(observedValues, [undefined, 2, undefined, 2]); assert.compareArray(own, [false, true, false, true]);
assert.sameValue(output === target, true);
console.log("copying-copy-within-leading:ok");
