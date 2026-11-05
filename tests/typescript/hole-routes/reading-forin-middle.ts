/*---
description: "for...in lists present keys as strings 0 and 2 and skips the missing index 1."
features: [ts-hole-routes, ts-hole-route-reading, ts-arrays]
---*/

// for...in lists present keys as strings 0 and 2 and skips the missing index 1. Route: generic helper. Node prints reading-forin-middle:ok.
type T = number | undefined | null;
const items: T[] = [1, , 3];
function view<U>(input: U[]): U[] { return input; }
const target = view<T>(items);
const result: string[] = []; for (const key in target) result.push(key);
assert.compareArray(result, ["0", "2"]);
const originalOwn: boolean[] = []; for (let i = 0; i < target.length; i++) originalOwn.push(i in target);
assert.compareArray(originalOwn, [true, false, true]);
console.log("reading-forin-middle:ok");
