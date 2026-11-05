/*---
description: "for...in lists only owned indexes 1 and 3, omitting leading and middle holes."
features: [ts-hole-routes, ts-hole-route-reading, ts-arrays]
---*/

// for...in lists only owned indexes 1 and 3, omitting leading and middle holes. Route: private class field. Node prints reading-forin-leading:ok.
type T = number | undefined | null;
const items: T[] = [, 2, , 4];
class Shelf { #data: T[]; constructor(v: T[]) { this.#data = v; } read(): T[] { return this.#data; } }
const target = new Shelf(items).read();
const result: string[] = []; for (const key in target) result.push(key);
assert.compareArray(result, ["1", "3"]);
const originalOwn: boolean[] = []; for (let i = 0; i < target.length; i++) originalOwn.push(i in target);
assert.compareArray(originalOwn, [false, true, false, true]);
console.log("reading-forin-leading:ok");
