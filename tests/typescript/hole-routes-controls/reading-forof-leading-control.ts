/*---
description: "for...of visits the leading hole as undefined before the two present numbers. (control)"
features: [ts-hole-routes, ts-hole-route-reading, ts-arrays]
---*/

// for...of visits the leading hole as undefined before the two present numbers. Route: generic helper. Node prints reading-forof-leading:ok.
type T = number | undefined | null;
const items: T[] = []; const present: boolean[] = [];
const source: readonly (readonly [boolean, T])[] = [[false, undefined], [true, 2], [true, 3]];
for (const entry of source) { items.push(entry[1]); present.push(entry[0]); }
function localForOf(data: T[], present: boolean[]): T[] { const result: T[] = []; for (let i = 0; i < data.length; i++) result.push(present[i] ? data[i] : undefined); return result; }
function view<U>(input: U[]): U[] { return input; }
const target = view<T>(items);
const result = localForOf(target, present);
assert.compareArray(result, [undefined, 2, 3]);
const originalOwn: boolean[] = []; for (let i = 0; i < target.length; i++) originalOwn.push(present[i]);
assert.compareArray(originalOwn, [false, true, true]);
console.log("reading-forof-leading:ok");
