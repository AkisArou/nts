/*---
description: "keys yields indexes 0, 1 and 2 even when index 1 is a hole. (control)"
features: [ts-hole-routes, ts-hole-route-reading, ts-arrays]
---*/

// keys yields indexes 0, 1 and 2 even when index 1 is a hole. Route: captured closure. Node prints reading-keys-middle:ok.
type T = number | undefined | null;
const items: T[] = []; const present: boolean[] = [];
const source: readonly (readonly [boolean, T])[] = [[true, 1], [false, undefined], [true, 3]];
for (const entry of source) { items.push(entry[1]); present.push(entry[0]); }
function localKeys<T>(data: T[], present: boolean[]): number[] { const result: number[] = []; for (let i = 0; i < data.length; i++) result.push(i); return result; }
let pointer: T[] = items; const take = (): T[] => pointer; const target = take();
const result = localKeys(target, present);
assert.compareArray(result, [0, 1, 2]);
const originalOwn: boolean[] = []; for (let i = 0; i < target.length; i++) originalOwn.push(present[i]);
assert.compareArray(originalOwn, [true, false, true]);
console.log("reading-keys-middle:ok");
