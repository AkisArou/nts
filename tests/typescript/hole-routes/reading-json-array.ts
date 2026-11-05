/*---
description: "JSON.stringify replaces a missing array index with null in its JSON text."
features: [ts-hole-routes, ts-hole-route-reading, ts-arrays]
---*/

// JSON.stringify replaces a missing array index with null in its JSON text. Route: private class field. Node prints reading-json-array:ok.
type T = number | undefined | null;
const items: T[] = [1, , 3];
class Shelf { #data: T[]; constructor(v: T[]) { this.#data = v; } read(): T[] { return this.#data; } }
const target = new Shelf(items).read();
const result = JSON.stringify(target);
assert.sameValue(result, '[1,null,3]');
const originalOwn: boolean[] = []; for (let i = 0; i < target.length; i++) originalOwn.push(i in target);
assert.compareArray(originalOwn, [true, false, true]);
console.log("reading-json-array:ok");
