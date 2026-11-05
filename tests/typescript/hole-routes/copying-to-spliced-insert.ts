/*---
description: "toSpliced(1, 0, 9) inserts 9 and turns the shifted hole into an owned undefined."
features: [ts-hole-routes, ts-hole-route-copying, ts-arrays]
---*/

// toSpliced(1, 0, 9) inserts 9 and turns the shifted hole into an owned undefined. Route: discriminated union. Node prints copying-to-spliced-insert:ok.
type V = number | undefined | number[];
const items: V[] = [1, , 3];
type Route = { tag: "array"; value: V[] } | { tag: "other"; value: V[] };
const entry: Route = { tag: "array", value: items }; const target = entry.value;
const result = target.toSpliced(1, 0, 9);
const output = result; const own: boolean[] = []; for (let i = 0; i < output.length; i++) own.push(i in output);
const observedValues: V[] = []; for (let i = 0; i < output.length; i++) observedValues.push(output[i]);
assert.compareArray(observedValues, [1, 9, undefined, 3]); assert.compareArray(own, [true, true, true, true]);
const sourceOwn: boolean[] = []; for (let i = 0; i < target.length; i++) sourceOwn.push(i in target);
assert.compareArray(sourceOwn, [true, false, true]);
console.log("copying-to-spliced-insert:ok");
