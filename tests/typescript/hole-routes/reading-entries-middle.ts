/*---
description: "entries yields every index, pairing the absent middle slot with undefined rather than skipping it."
features: [ts-hole-routes, ts-hole-route-reading, ts-arrays]
---*/

// entries yields every index, pairing the absent middle slot with undefined rather than skipping it. Route: discriminated union. Node prints reading-entries-middle:ok.
type T = number | undefined | null;
const items: T[] = [1, , 3];
type Choice = { kind: "a"; array: T[] } | { kind: "b"; array: T[] };
const selection: Choice = { kind: "a", array: items }; const target = selection.array;
const result: [number, T][] = []; for (const entry of target.entries()) result.push(entry);
assert.sameValue(result.length, 3);
for (let i = 0; i < result.length; i++) assert.compareArray(result[i], [[0, 1], [1, undefined], [2, 3]][i]);
const originalOwn: boolean[] = []; for (let i = 0; i < target.length; i++) originalOwn.push(i in target);
assert.compareArray(originalOwn, [true, false, true]);
console.log("reading-entries-middle:ok");
