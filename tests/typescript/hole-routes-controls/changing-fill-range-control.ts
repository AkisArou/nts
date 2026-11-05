/*---
description: "fill(7, 1, 3) fills the interior hole while leaving index 0 absent. (control)"
features: [ts-hole-routes, ts-hole-route-changing, ts-arrays]
---*/

// fill(7, 1, 3) fills the interior hole while leaving index 0 absent. Route: private class field. Node prints changing-fill-range:ok.
type V = number | undefined;
const items: V[] = [], present: boolean[] = [];
const cells: readonly (readonly [boolean, V])[] = [[false, undefined], [true, 2], [false, undefined], [true, 4]];
for (const cell of cells) { items.push(cell[1]); present.push(cell[0]); }
function localFill(values: V[], present: boolean[], value: V, start: number = 0, end: number = values.length): V[] { for (let i = start; i < end; i++) { values[i] = value; present[i] = true; } return values; }
class Box { #data: V[]; constructor(v: V[]) { this.#data = v; } get(): V[] { return this.#data; } }
const target = new Box(items).get();
const result = localFill(target, present, 7, 1, 3);
const current: V[] = [], currentOwn: boolean[] = [];
for (let i = 0; i < target.length; i++) { current.push(present[i] ? target[i] : undefined); currentOwn.push(present[i]); }
assert.compareArray(current, [undefined, 7, 7, 4]);
assert.compareArray(currentOwn, [false, true, true, true]);
assert.sameValue(result, target);
console.log("changing-fill-range:ok");
