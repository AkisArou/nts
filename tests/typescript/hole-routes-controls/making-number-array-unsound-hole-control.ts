/*---
description: "A declared number array still reads its missing element as undefined and arithmetic yields NaN. (control)"
features: [ts-hole-routes, ts-hole-route-making, ts-arrays]
---*/

// A declared number array still reads its missing element as undefined and arithmetic yields NaN. Route: private class field. Node prints making-number-array-unsound-hole:ok.
const items: number[] = []; const present: boolean[] = [];
function localArrayLength(values: number[], presence: boolean[], count: number): void { for (let i = 0; i < count; i++) { values.push(0); presence.push(false); } }
localArrayLength(items, present, 3);
class NumberShelf { #stored: number[]; constructor(data: number[]) { this.#stored = data; } get(): number[] { return this.#stored; } }
const routed = new NumberShelf(items).get();
assert.sameValue(typeof (present[0] ? routed[0] : undefined), "undefined");
assert.sameValue(Number(present[0] ? routed[0] : undefined) + 1, NaN);
assert.compareArray(present, [false, false, false]);
console.log("making-number-array-unsound-hole:ok");
