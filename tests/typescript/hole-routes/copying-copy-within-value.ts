/*---
description: "copyWithin(2, 0, 2) fills a destination hole when the corresponding source index has a number."
features: [ts-hole-routes, ts-hole-route-copying, ts-arrays]
---*/

// copyWithin(2, 0, 2) fills a destination hole when the corresponding source index has a number. Route: discriminated union. Node prints copying-copy-within-value:ok.
type V = number | undefined | number[];
const items: V[] = [1, 2, , 4];
type Route = { tag: "array"; value: V[] } | { tag: "other"; value: V[] };
const entry: Route = { tag: "array", value: items }; const target = entry.value;
const result = target.copyWithin(2, 0, 2);
const output = result; const own: boolean[] = []; for (let i = 0; i < output.length; i++) own.push(i in output);
const observedValues: V[] = []; for (let i = 0; i < output.length; i++) observedValues.push(output[i]);
assert.compareArray(observedValues, [1, 2, 1, 2]); assert.compareArray(own, [true, true, true, true]);
assert.sameValue(output === target, true);
console.log("copying-copy-within-value:ok");
