/*---
description: "fill(7, 1, 3) fills the interior hole while leaving index 0 absent."
features: [ts-hole-routes, ts-hole-route-changing, ts-arrays]
---*/

// fill(7, 1, 3) fills the interior hole while leaving index 0 absent. Route: private class field. Node prints changing-fill-range:ok.
type V = number | undefined;
const items: V[] = [, 2, , 4];
class Box { #data: V[]; constructor(v: V[]) { this.#data = v; } get(): V[] { return this.#data; } }
const target = new Box(items).get();
const result = target.fill(7, 1, 3);
const current: V[] = [], currentOwn: boolean[] = [];
for (let i = 0; i < target.length; i++) { current.push(target[i]); currentOwn.push(i in target); }
assert.compareArray(current, [undefined, 7, 7, 4]);
assert.compareArray(currentOwn, [false, true, true, true]);
assert.sameValue(result, target);
console.log("changing-fill-range:ok");
