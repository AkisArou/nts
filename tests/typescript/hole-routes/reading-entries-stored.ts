/*---
description: "entries yields both stored undefined and a separate hole as distinct indexed entries with undefined values."
features: [ts-hole-routes, ts-hole-route-reading, ts-arrays]
---*/

// entries yields both stored undefined and a separate hole as distinct indexed entries with undefined values. Route: interface field. Node prints reading-entries-stored:ok.
type T = number | undefined | null;
const items: T[] = [undefined, , 3];
interface Supply { values: T[]; }
const holder: Supply = { values: items }; const target = holder.values;
const result: [number, T][] = []; for (const entry of target.entries()) result.push(entry);
assert.sameValue(result.length, 3);
for (let i = 0; i < result.length; i++) assert.compareArray(result[i], [[0, undefined], [1, undefined], [2, 3]][i]);
const originalOwn: boolean[] = []; for (let i = 0; i < target.length; i++) originalOwn.push(i in target);
assert.compareArray(originalOwn, [true, false, true]);
console.log("reading-entries-stored:ok");
