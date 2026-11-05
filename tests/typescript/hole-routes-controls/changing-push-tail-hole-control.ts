/*---
description: "push(5) appends an owned value after a hole without filling that hole. (control)"
features: [ts-hole-routes, ts-hole-route-changing, ts-arrays]
---*/

// push(5) appends an owned value after a hole without filling that hole. Route: private class field. Node prints changing-push-tail-hole:ok.
type V = number | undefined;
const items: V[] = [], present: boolean[] = [];
const cells: readonly (readonly [boolean, V])[] = [[true, 1], [false, undefined]];
for (const cell of cells) { items.push(cell[1]); present.push(cell[0]); }
function localPush(values: V[], present: boolean[], value: V): number { values.push(value); present.push(true); return values.length; }
class Box { #data: V[]; constructor(v: V[]) { this.#data = v; } get(): V[] { return this.#data; } }
const target = new Box(items).get();
const result = localPush(target, present, 5);
const current: V[] = [], currentOwn: boolean[] = [];
for (let i = 0; i < target.length; i++) { current.push(present[i] ? target[i] : undefined); currentOwn.push(present[i]); }
assert.compareArray(current, [1, undefined, 5]);
assert.compareArray(currentOwn, [true, false, true]);
assert.sameValue(result, 3);
console.log("changing-push-tail-hole:ok");
