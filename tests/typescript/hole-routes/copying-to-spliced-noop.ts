/*---
description: "toSpliced(0, 0) leaves the values in order but fills the middle hole."
features: [ts-hole-routes, ts-hole-route-copying, ts-arrays]
---*/

// toSpliced(0, 0) leaves the values in order but fills the middle hole. Route: readonly tuple row. Node prints copying-to-spliced-noop:ok.
type V = number | undefined | number[];
const items: V[] = [1, , 3];
const rows: readonly [string, V[]][] = [["one", items]];
const target = rows[0][1];
const result = target.toSpliced(0, 0);
const output = result; const own: boolean[] = []; for (let i = 0; i < output.length; i++) own.push(i in output);
const observedValues: V[] = []; for (let i = 0; i < output.length; i++) observedValues.push(output[i]);
assert.compareArray(observedValues, [1, undefined, 3]); assert.compareArray(own, [true, true, true]);
const sourceOwn: boolean[] = []; for (let i = 0; i < target.length; i++) sourceOwn.push(i in target);
assert.compareArray(sourceOwn, [true, false, true]);
console.log("copying-to-spliced-noop:ok");
