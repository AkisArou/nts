/*---
description: "push(5) appends an owned value after a hole without filling that hole."
features: [ts-hole-routes, ts-hole-route-changing, ts-arrays]
---*/

// push(5) appends an owned value after a hole without filling that hole. Route: private class field. Node prints changing-push-tail-hole:ok.
type V = number | undefined;
const items: V[] = [1, , ];
class Box { #data: V[]; constructor(v: V[]) { this.#data = v; } get(): V[] { return this.#data; } }
const target = new Box(items).get();
const result = target.push(5);
const current: V[] = [], currentOwn: boolean[] = [];
for (let i = 0; i < target.length; i++) { current.push(target[i]); currentOwn.push(i in target); }
assert.compareArray(current, [1, undefined, 5]);
assert.compareArray(currentOwn, [true, false, true]);
assert.sameValue(result, 3);
console.log("changing-push-tail-hole:ok");
