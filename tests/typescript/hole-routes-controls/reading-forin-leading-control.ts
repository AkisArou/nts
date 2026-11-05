/*---
description: "for...in lists only owned indexes 1 and 3, omitting leading and middle holes. (control)"
features: [ts-hole-routes, ts-hole-route-reading, ts-arrays]
---*/

// for...in lists only owned indexes 1 and 3, omitting leading and middle holes. Route: private class field. Node prints reading-forin-leading:ok.
type T = number | undefined | null;
const items: T[] = []; const present: boolean[] = [];
const source: readonly (readonly [boolean, T])[] = [[false, undefined], [true, 2], [false, undefined], [true, 4]];
for (const entry of source) { items.push(entry[1]); present.push(entry[0]); }
function localForIn<T>(data: T[], present: boolean[]): string[] { const result: string[] = []; for (let i = 0; i < data.length; i++) if (present[i]) result.push(String(i)); return result; }
class Shelf { #data: T[]; constructor(v: T[]) { this.#data = v; } read(): T[] { return this.#data; } }
const target = new Shelf(items).read();
const result = localForIn(target, present);
assert.compareArray(result, ["1", "3"]);
const originalOwn: boolean[] = []; for (let i = 0; i < target.length; i++) originalOwn.push(present[i]);
assert.compareArray(originalOwn, [false, true, false, true]);
console.log("reading-forin-leading:ok");
