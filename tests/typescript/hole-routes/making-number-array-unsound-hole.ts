/*---
description: "A declared number array still reads its missing element as undefined and arithmetic yields NaN."
features: [ts-hole-routes, ts-hole-route-making, ts-arrays]
---*/

// A declared number array still reads its missing element as undefined and arithmetic yields NaN. Route: private class field. Node prints making-number-array-unsound-hole:ok.
const items: number[] = new Array<number>(3);
class NumberShelf { #stored: number[]; constructor(data: number[]) { this.#stored = data; } get(): number[] { return this.#stored; } }
const routed = new NumberShelf(items).get();
assert.sameValue(typeof (routed[0]), "undefined");
assert.sameValue(routed[0] + 1, NaN);
assert.compareArray([0, 1, 2].map(i => i in routed), [false, false, false]);
console.log("making-number-array-unsound-hole:ok");
