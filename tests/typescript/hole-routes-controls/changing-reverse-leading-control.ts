/*---
description: "reverse moves a leading hole to the end while preserving its absence. (control)"
features: [ts-hole-routes, ts-hole-route-changing, ts-arrays]
---*/

// reverse moves a leading hole to the end while preserving its absence. Route: private class field. Node prints changing-reverse-leading:ok.
type V = number | undefined;
const items: V[] = [], present: boolean[] = [];
const cells: readonly (readonly [boolean, V])[] = [[false, undefined], [true, 2], [true, 3]];
for (const cell of cells) { items.push(cell[1]); present.push(cell[0]); }
function localReverse(values: V[], present: boolean[]): V[] { for (let i = 0; i < values.length / 2; i++) { const j = values.length - 1 - i; const v = values[i], f = present[i]; values[i] = values[j]; present[i] = present[j]; values[j] = v; present[j] = f; } return values; }
class Box { #data: V[]; constructor(v: V[]) { this.#data = v; } get(): V[] { return this.#data; } }
const target = new Box(items).get();
const result = localReverse(target, present);
const current: V[] = [], currentOwn: boolean[] = [];
for (let i = 0; i < target.length; i++) { current.push(present[i] ? target[i] : undefined); currentOwn.push(present[i]); }
assert.compareArray(current, [3, 2, undefined]);
assert.compareArray(currentOwn, [true, true, false]);
assert.sameValue(result, target);
console.log("changing-reverse-leading:ok");
