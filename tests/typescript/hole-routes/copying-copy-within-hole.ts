/*---
description: "copyWithin(2, 0, 2) copies a source hole into index 3 as a hole and a number into index 2."
features: [ts-hole-routes, ts-hole-route-copying, ts-arrays]
---*/

// copyWithin(2, 0, 2) copies a source hole into index 3 as a hole and a number into index 2. Route: readonly tuple row. Node prints copying-copy-within-hole:ok.
type V = number | undefined | number[];
const items: V[] = [1, , 3, 4];
const rows: readonly [string, V[]][] = [["one", items]];
const target = rows[0][1];
const result = target.copyWithin(2, 0, 2);
const output = result; const own: boolean[] = []; for (let i = 0; i < output.length; i++) own.push(i in output);
const observedValues: V[] = []; for (let i = 0; i < output.length; i++) observedValues.push(output[i]);
assert.compareArray(observedValues, [1, undefined, 1, undefined]); assert.compareArray(own, [true, false, true, false]);
assert.sameValue(output === target, true);
console.log("copying-copy-within-hole:ok");
