/*---
description: "flat(0) drops both absent positions and returns an empty dense array."
features: [ts-hole-routes, ts-hole-route-copying, ts-arrays]
---*/

// flat(0) drops both absent positions and returns an empty dense array. Route: captured closure. Node prints copying-flat-all-holes:ok.
type V = number | undefined | number[];
const items: V[] = [, ,];
let current = items; const read = (): V[] => current; const target = read();
const result = target.flat(0);
const output = result; const own: boolean[] = []; for (let i = 0; i < output.length; i++) own.push(i in output);
const observedValues: V[] = []; for (let i = 0; i < output.length; i++) observedValues.push(output[i]);
assert.compareArray(observedValues, []); assert.compareArray(own, []);
const sourceOwn: boolean[] = []; for (let i = 0; i < target.length; i++) sourceOwn.push(i in target);
assert.compareArray(sourceOwn, [false, false]);
console.log("copying-flat-all-holes:ok");
