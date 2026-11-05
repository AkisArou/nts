/*---
description: "flat(0) removes a middle hole instead of preserving its position."
features: [ts-hole-routes, ts-hole-route-copying, ts-arrays]
---*/

// flat(0) removes a middle hole instead of preserving its position. Route: guarded Map.get lookup. Node prints copying-flat-zero:ok.
type V = number | undefined | number[];
const items: V[] = [1, , 3];
const map = new Map<string, V[]>(); map.set("x", items);
const found = map.get("x"); if (found === undefined) throw new Error("missing"); const target = found;
const result = target.flat(0);
const output = result; const own: boolean[] = []; for (let i = 0; i < output.length; i++) own.push(i in output);
const observedValues: V[] = []; for (let i = 0; i < output.length; i++) observedValues.push(output[i]);
assert.compareArray(observedValues, [1, 3]); assert.compareArray(own, [true, true]);
const sourceOwn: boolean[] = []; for (let i = 0; i < target.length; i++) sourceOwn.push(i in target);
assert.compareArray(sourceOwn, [true, false, true]);
console.log("copying-flat-zero:ok");
