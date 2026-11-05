/*---
description: "values visits a stored undefined and an adjacent hole separately, both reading undefined. (control)"
features: [ts-hole-routes, ts-hole-route-reading, ts-arrays]
---*/

// values visits a stored undefined and an adjacent hole separately, both reading undefined. Route: private class field. Node prints reading-values-stored:ok.
type T = number | undefined | null;
const items: T[] = []; const present: boolean[] = [];
const source: readonly (readonly [boolean, T])[] = [[true, 1], [true, undefined], [false, undefined], [true, 3]];
for (const entry of source) { items.push(entry[1]); present.push(entry[0]); }
function localValues(data: T[], present: boolean[]): T[] { const result: T[] = []; for (let i = 0; i < data.length; i++) result.push(present[i] ? data[i] : undefined); return result; }
class Shelf { #data: T[]; constructor(v: T[]) { this.#data = v; } read(): T[] { return this.#data; } }
const target = new Shelf(items).read();
const result = localValues(target, present);
assert.compareArray(result, [1, undefined, undefined, 3]);
const originalOwn: boolean[] = []; for (let i = 0; i < target.length; i++) originalOwn.push(present[i]);
assert.compareArray(originalOwn, [true, true, false, true]);
console.log("reading-values-stored:ok");
