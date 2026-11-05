/*---
description: "Array.from's mapper visits a middle hole as undefined and produces a dense [10, 0, 30] copy."
features: [ts-hole-routes, ts-hole-route-copying, ts-arrays]
---*/

// Array.from's mapper visits a middle hole as undefined and produces a dense [10, 0, 30] copy. Route: private class field. Node prints copying-from-map:ok.
type V = number | undefined | number[];
const items: V[] = [1, , 3];
class Shelf { #data: V[]; constructor(v: V[]) { this.#data = v; } get(): V[] { return this.#data; } }
const target = new Shelf(items).get();
const result = Array.from(target, (v, i) => v === undefined ? 0 : Number(v) * 10);
const output = result; const own: boolean[] = []; for (let i = 0; i < output.length; i++) own.push(i in output);
const observedValues: V[] = []; for (let i = 0; i < output.length; i++) observedValues.push(output[i]);
assert.compareArray(observedValues, [10, 0, 30]); assert.compareArray(own, [true, true, true]);
const sourceOwn: boolean[] = []; for (let i = 0; i < target.length; i++) sourceOwn.push(i in target);
assert.compareArray(sourceOwn, [true, false, true]);
console.log("copying-from-map:ok");
