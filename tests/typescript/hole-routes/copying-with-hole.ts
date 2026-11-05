/*---
description: "with(1, 2) replaces the hole with a present number, yielding a dense copy."
features: [ts-hole-routes, ts-hole-route-copying, ts-arrays]
---*/

// with(1, 2) replaces the hole with a present number, yielding a dense copy. Route: private class field. Node prints copying-with-hole:ok.
type V = number | undefined | number[];
const items: V[] = [1, , 3];
class Shelf { #data: V[]; constructor(v: V[]) { this.#data = v; } get(): V[] { return this.#data; } }
const target = new Shelf(items).get();
const result = target.with(1, 2);
const output = result; const own: boolean[] = []; for (let i = 0; i < output.length; i++) own.push(i in output);
const observedValues: V[] = []; for (let i = 0; i < output.length; i++) observedValues.push(output[i]);
assert.compareArray(observedValues, [1, 2, 3]); assert.compareArray(own, [true, true, true]);
const sourceOwn: boolean[] = []; for (let i = 0; i < target.length; i++) sourceOwn.push(i in target);
assert.compareArray(sourceOwn, [true, false, true]);
console.log("copying-with-hole:ok");
