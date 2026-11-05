/*---
description: "keys yields both indexes of a trailing-hole array, including the absent slot."
features: [ts-hole-routes, ts-hole-route-reading, ts-arrays]
---*/

// keys yields both indexes of a trailing-hole array, including the absent slot. Route: readonly tuple row. Node prints reading-keys-trailing:ok.
type T = number | undefined | null;
const items: T[] = [1, , ];
const rows: readonly [string, T[]][] = [["x", items]];
const target = rows[0][1];
const result: number[] = []; for (const key of target.keys()) result.push(key);
assert.compareArray(result, [0, 1]);
const originalOwn: boolean[] = []; for (let i = 0; i < target.length; i++) originalOwn.push(i in target);
assert.compareArray(originalOwn, [true, false]);
console.log("reading-keys-trailing:ok");
