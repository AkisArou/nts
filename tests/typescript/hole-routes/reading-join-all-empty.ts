/*---
description: "join prints a hole, stored undefined and null as empty fields separated by commas."
features: [ts-hole-routes, ts-hole-route-reading, ts-arrays]
---*/

// join prints a hole, stored undefined and null as empty fields separated by commas. Route: readonly tuple row. Node prints reading-join-all-empty:ok.
type T = number | undefined | null;
const items: T[] = [, undefined, null];
const rows: readonly [string, T[]][] = [["x", items]];
const target = rows[0][1];
const result = target.join();
assert.sameValue(result, ",,");
const originalOwn: boolean[] = []; for (let i = 0; i < target.length; i++) originalOwn.push(i in target);
assert.compareArray(originalOwn, [false, true, true]);
console.log("reading-join-all-empty:ok");
