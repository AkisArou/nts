/*---
description: "entries yields both stored undefined and a separate hole as distinct indexed entries with undefined values. (control)"
features: [ts-hole-routes, ts-hole-route-reading, ts-arrays]
---*/

// entries yields both stored undefined and a separate hole as distinct indexed entries with undefined values. Route: interface field. Node prints reading-entries-stored:ok.
type T = number | undefined | null;
const items: T[] = []; const present: boolean[] = [];
const source: readonly (readonly [boolean, T])[] = [[true, undefined], [false, undefined], [true, 3]];
for (const entry of source) { items.push(entry[1]); present.push(entry[0]); }
function localEntries(data: T[], present: boolean[]): [number, T][] { const result: [number, T][] = []; for (let i = 0; i < data.length; i++) result.push([i, present[i] ? data[i] : undefined]); return result; }
interface Supply { values: T[]; }
const holder: Supply = { values: items }; const target = holder.values;
const result = localEntries(target, present);
assert.sameValue(result.length, 3);
for (let i = 0; i < result.length; i++) assert.compareArray(result[i], [[0, undefined], [1, undefined], [2, 3]][i]);
const originalOwn: boolean[] = []; for (let i = 0; i < target.length; i++) originalOwn.push(present[i]);
assert.compareArray(originalOwn, [true, false, true]);
console.log("reading-entries-stored:ok");
