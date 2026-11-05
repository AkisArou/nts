/*---
description: "entries yields every index, pairing the absent middle slot with undefined rather than skipping it. (control)"
features: [ts-hole-routes, ts-hole-route-reading, ts-arrays]
---*/

// entries yields every index, pairing the absent middle slot with undefined rather than skipping it. Route: discriminated union. Node prints reading-entries-middle:ok.
type T = number | undefined | null;
const items: T[] = []; const present: boolean[] = [];
const source: readonly (readonly [boolean, T])[] = [[true, 1], [false, undefined], [true, 3]];
for (const entry of source) { items.push(entry[1]); present.push(entry[0]); }
function localEntries(data: T[], present: boolean[]): [number, T][] { const result: [number, T][] = []; for (let i = 0; i < data.length; i++) result.push([i, present[i] ? data[i] : undefined]); return result; }
type Choice = { kind: "a"; array: T[] } | { kind: "b"; array: T[] };
const selection: Choice = { kind: "a", array: items }; const target = selection.array;
const result = localEntries(target, present);
assert.sameValue(result.length, 3);
for (let i = 0; i < result.length; i++) assert.compareArray(result[i], [[0, 1], [1, undefined], [2, 3]][i]);
const originalOwn: boolean[] = []; for (let i = 0; i < target.length; i++) originalOwn.push(present[i]);
assert.compareArray(originalOwn, [true, false, true]);
console.log("reading-entries-middle:ok");
