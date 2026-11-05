/*---
description: "Adjacent elisions remain two distinct absent indexes. (control)"
features: [ts-hole-routes, ts-hole-route-making, ts-arrays]
---*/

// Adjacent elisions remain two distinct absent indexes. Route: private class field. Node prints making-elision-adjacent-class:ok.
type V = number | string | undefined;
function localElision(values: V[], present: boolean[], cells: readonly (readonly [boolean, V])[]): void { for (let i = 0; i < cells.length; i++) { values.push(cells[i][1]); present.push(cells[i][0]); } }
const items: V[] = []; const present: boolean[] = [];
localElision(items, present, [[true, 1], [false, undefined], [false, undefined], [true, 4]]);
class HoleHolder { #stored: V[]; constructor(value: V[]) { this.#stored = value; } get(): V[] { return this.#stored; } }
const routed = new HoleHolder(items).get();
const actual: V[] = []; const observed: boolean[] = [];
for (let i = 0; i < routed.length; i++) { actual.push(present[i] ? routed[i] : undefined); observed.push(present[i]); }
assert.sameValue(routed.length, 4);
assert.compareArray(actual, [1, undefined, undefined, 4]); assert.compareArray(observed, [true, false, false, true]);
console.log("making-elision-adjacent-class:ok");
