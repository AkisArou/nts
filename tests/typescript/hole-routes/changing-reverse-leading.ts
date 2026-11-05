/*---
description: "reverse moves a leading hole to the end while preserving its absence."
features: [ts-hole-routes, ts-hole-route-changing, ts-arrays]
---*/

// reverse moves a leading hole to the end while preserving its absence. Route: private class field. Node prints changing-reverse-leading:ok.
type V = number | undefined;
const items: V[] = [, 2, 3];
class Box { #data: V[]; constructor(v: V[]) { this.#data = v; } get(): V[] { return this.#data; } }
const target = new Box(items).get();
const result = target.reverse();
const current: V[] = [], currentOwn: boolean[] = [];
for (let i = 0; i < target.length; i++) { current.push(target[i]); currentOwn.push(i in target); }
assert.compareArray(current, [3, 2, undefined]);
assert.compareArray(currentOwn, [true, true, false]);
assert.sameValue(result, target);
console.log("changing-reverse-leading:ok");
