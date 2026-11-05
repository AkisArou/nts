/*---
description: "keys yields both indexes of a trailing-hole array, including the absent slot. (control)"
features: [ts-hole-routes, ts-hole-route-reading, ts-arrays]
---*/

// keys yields both indexes of a trailing-hole array, including the absent slot. Route: readonly tuple row. Node prints reading-keys-trailing:ok.
type T = number | undefined | null;
const items: T[] = []; const present: boolean[] = [];
const source: readonly (readonly [boolean, T])[] = [[true, 1], [false, undefined]];
for (const entry of source) { items.push(entry[1]); present.push(entry[0]); }
function localKeys<T>(data: T[], present: boolean[]): number[] { const result: number[] = []; for (let i = 0; i < data.length; i++) result.push(i); return result; }
const rows: readonly [string, T[]][] = [["x", items]];
const target = rows[0][1];
const result = localKeys(target, present);
assert.compareArray(result, [0, 1]);
const originalOwn: boolean[] = []; for (let i = 0; i < target.length; i++) originalOwn.push(present[i]);
assert.compareArray(originalOwn, [true, false]);
console.log("reading-keys-trailing:ok");
