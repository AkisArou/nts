/*---
description: "Growing length appends absent slots rather than owned undefined. (control)"
features: [ts-hole-routes, ts-hole-route-making, ts-arrays]
---*/

// Growing length appends absent slots rather than owned undefined. Route: private class field. Node prints making-length-grow-class:ok.
type V = number | string | undefined;
function localElision(values: V[], present: boolean[], cells: readonly (readonly [boolean, V])[]): void { for (let i = 0; i < cells.length; i++) { values.push(cells[i][1]); present.push(cells[i][0]); } }
function localLength(values: V[], present: boolean[], size: number): void { if (size < 0 || size % 1 !== 0 || size > 1000) throw new RangeError(); while (values.length > size) { values.pop(); present.pop(); } while (values.length < size) { values.push(undefined); present.push(false); } }
const items: V[] = []; const present: boolean[] = [];
localElision(items, present, [[true, 1], [true, 2]]);
class HoleHolder { #stored: V[]; constructor(value: V[]) { this.#stored = value; } get(): V[] { return this.#stored; } }
const routed = new HoleHolder(items).get();
localLength(routed, present, 5);
const actual: V[] = []; const observed: boolean[] = [];
for (let i = 0; i < routed.length; i++) { actual.push(present[i] ? routed[i] : undefined); observed.push(present[i]); }
assert.sameValue(routed.length, 5);
assert.compareArray(actual, [1, 2, undefined, undefined, undefined]); assert.compareArray(observed, [true, true, false, false, false]);
console.log("making-length-grow-class:ok");
