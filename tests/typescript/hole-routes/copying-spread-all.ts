/*---
description: "array spread converts two holes into two owned undefined values."
features: [ts-hole-routes, ts-hole-route-copying, ts-arrays]
---*/

// array spread converts two holes into two owned undefined values. Route: discriminated union. Node prints copying-spread-all:ok.
type V = number | undefined | number[];
const items: V[] = [, ,];
type Route = { tag: "array"; value: V[] } | { tag: "other"; value: V[] };
const entry: Route = { tag: "array", value: items }; const target = entry.value;
const result = [...target];
const output = result; const own: boolean[] = []; for (let i = 0; i < output.length; i++) own.push(i in output);
const observedValues: V[] = []; for (let i = 0; i < output.length; i++) observedValues.push(output[i]);
assert.compareArray(observedValues, [undefined, undefined]); assert.compareArray(own, [true, true]);
const sourceOwn: boolean[] = []; for (let i = 0; i < target.length; i++) sourceOwn.push(i in target);
assert.compareArray(sourceOwn, [false, false]);
console.log("copying-spread-all:ok");
