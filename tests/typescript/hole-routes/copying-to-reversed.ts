/*---
description: "toReversed returns [3, undefined, 1] and fills the original middle hole."
features: [ts-hole-routes, ts-hole-route-copying, ts-arrays]
---*/

// toReversed returns [3, undefined, 1] and fills the original middle hole. Route: guarded Map.get lookup. Node prints copying-to-reversed:ok.
type V = number | undefined | number[];
const items: V[] = [1, , 3];
const map = new Map<string, V[]>(); map.set("x", items);
const found = map.get("x"); if (found === undefined) throw new Error("missing"); const target = found;
const result = target.toReversed();
const output = result; const own: boolean[] = []; for (let i = 0; i < output.length; i++) own.push(i in output);
const observedValues: V[] = []; for (let i = 0; i < output.length; i++) observedValues.push(output[i]);
assert.compareArray(observedValues, [3, undefined, 1]); assert.compareArray(own, [true, true, true]);
const sourceOwn: boolean[] = []; for (let i = 0; i < target.length; i++) sourceOwn.push(i in target);
assert.compareArray(sourceOwn, [true, false, true]);
console.log("copying-to-reversed:ok");
