/*---
description: "values visits a stored undefined and an adjacent hole separately, both reading undefined."
features: [ts-hole-routes, ts-hole-route-reading, ts-arrays]
---*/

// values visits a stored undefined and an adjacent hole separately, both reading undefined. Route: private class field. Node prints reading-values-stored:ok.
type T = number | undefined | null;
const items: T[] = [1, undefined, , 3];
class Shelf { #data: T[]; constructor(v: T[]) { this.#data = v; } read(): T[] { return this.#data; } }
const target = new Shelf(items).read();
const result: T[] = []; for (const value of target.values()) result.push(value);
assert.compareArray(result, [1, undefined, undefined, 3]);
const originalOwn: boolean[] = []; for (let i = 0; i < target.length; i++) originalOwn.push(i in target);
assert.compareArray(originalOwn, [true, true, false, true]);
console.log("reading-values-stored:ok");
