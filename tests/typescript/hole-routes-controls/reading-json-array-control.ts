/*---
description: "JSON.stringify replaces a missing array index with null in its JSON text. (control)"
features: [ts-hole-routes, ts-hole-route-reading, ts-arrays]
---*/

// JSON.stringify replaces a missing array index with null in its JSON text. Route: private class field. Node prints reading-json-array:ok.
type T = number | undefined | null;
const items: T[] = []; const present: boolean[] = [];
const source: readonly (readonly [boolean, T])[] = [[true, 1], [false, undefined], [true, 3]];
for (const entry of source) { items.push(entry[1]); present.push(entry[0]); }
function localJson(data: T[], present: boolean[]): string { let result = "["; for (let i = 0; i < data.length; i++) { if (i > 0) result += ","; result += present[i] && data[i] !== undefined && data[i] !== null ? String(data[i]) : "null"; } return result + "]"; }
class Shelf { #data: T[]; constructor(v: T[]) { this.#data = v; } read(): T[] { return this.#data; } }
const target = new Shelf(items).read();
const result = localJson(target, present);
assert.sameValue(result, '[1,null,3]');
const originalOwn: boolean[] = []; for (let i = 0; i < target.length; i++) originalOwn.push(present[i]);
assert.compareArray(originalOwn, [true, false, true]);
console.log("reading-json-array:ok");
