/*---
description: "keys yields indexes 0, 1 and 2 even when index 1 is a hole."
features: [ts-hole-routes, ts-hole-route-reading, ts-arrays]
---*/

// keys yields indexes 0, 1 and 2 even when index 1 is a hole. Route: captured closure. Node prints reading-keys-middle:ok.
type T = number | undefined | null;
const items: T[] = [1, , 3];
let pointer: T[] = items; const take = (): T[] => pointer; const target = take();
const result: number[] = []; for (const key of target.keys()) result.push(key);
assert.compareArray(result, [0, 1, 2]);
const originalOwn: boolean[] = []; for (let i = 0; i < target.length; i++) originalOwn.push(i in target);
assert.compareArray(originalOwn, [true, false, true]);
console.log("reading-keys-middle:ok");
