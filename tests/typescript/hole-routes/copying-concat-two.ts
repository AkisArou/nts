/*---
description: "concat preserves the absent indexes in both input arrays instead of filling them with undefined."
features: [ts-hole-routes, ts-hole-route-copying, ts-arrays]
---*/

// concat preserves the absent indexes in both input arrays instead of filling them with undefined. Route: guarded Map.get lookup. Node prints copying-concat-two:ok.
type V = number | undefined | number[];
const items: V[] = [1, , 3];
const map = new Map<string, V[]>(); map.set("x", items);
const found = map.get("x"); if (found === undefined) throw new Error("missing"); const target = found;
const result = target.concat([4, , 6]);
const output = result; const own: boolean[] = []; for (let i = 0; i < output.length; i++) own.push(i in output);
const observedValues: V[] = []; for (let i = 0; i < output.length; i++) observedValues.push(output[i]);
assert.compareArray(observedValues, [1, undefined, 3, 4, undefined, 6]); assert.compareArray(own, [true, false, true, true, false, true]);
const sourceOwn: boolean[] = []; for (let i = 0; i < target.length; i++) sourceOwn.push(i in target);
assert.compareArray(sourceOwn, [true, false, true]);
console.log("copying-concat-two:ok");
