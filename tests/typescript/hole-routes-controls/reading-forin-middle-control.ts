/*---
description: "for...in lists present keys as strings 0 and 2 and skips the missing index 1. (control)"
features: [ts-hole-routes, ts-hole-route-reading, ts-arrays]
---*/

// for...in lists present keys as strings 0 and 2 and skips the missing index 1. Route: generic helper. Node prints reading-forin-middle:ok.
type T = number | undefined | null;
const items: T[] = []; const present: boolean[] = [];
const source: readonly (readonly [boolean, T])[] = [[true, 1], [false, undefined], [true, 3]];
for (const entry of source) { items.push(entry[1]); present.push(entry[0]); }
function localForIn<T>(data: T[], present: boolean[]): string[] { const result: string[] = []; for (let i = 0; i < data.length; i++) if (present[i]) result.push(String(i)); return result; }
function view<U>(input: U[]): U[] { return input; }
const target = view<T>(items);
const result = localForIn(target, present);
assert.compareArray(result, ["0", "2"]);
const originalOwn: boolean[] = []; for (let i = 0; i < target.length; i++) originalOwn.push(present[i]);
assert.compareArray(originalOwn, [true, false, true]);
console.log("reading-forin-middle:ok");
