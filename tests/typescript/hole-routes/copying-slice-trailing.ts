/*---
description: "slice(1, 3) retains the trailing hole rather than making an owned undefined."
features: [ts-hole-routes, ts-hole-route-copying, ts-arrays]
---*/

// slice(1, 3) retains the trailing hole rather than making an owned undefined. Route: private class field. Node prints copying-slice-trailing:ok.
type V = number | undefined | number[];
const items: V[] = [1, 2, ,];
class Shelf { #data: V[]; constructor(v: V[]) { this.#data = v; } get(): V[] { return this.#data; } }
const target = new Shelf(items).get();
const result = target.slice(1, 3);
const output = result; const own: boolean[] = []; for (let i = 0; i < output.length; i++) own.push(i in output);
const observedValues: V[] = []; for (let i = 0; i < output.length; i++) observedValues.push(output[i]);
assert.compareArray(observedValues, [2, undefined]); assert.compareArray(own, [true, false]);
const sourceOwn: boolean[] = []; for (let i = 0; i < target.length; i++) sourceOwn.push(i in target);
assert.compareArray(sourceOwn, [true, true, false]);
console.log("copying-slice-trailing:ok");
