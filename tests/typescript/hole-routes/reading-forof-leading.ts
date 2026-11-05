/*---
description: "for...of visits the leading hole as undefined before the two present numbers."
features: [ts-hole-routes, ts-hole-route-reading, ts-arrays]
---*/

// for...of visits the leading hole as undefined before the two present numbers. Route: generic helper. Node prints reading-forof-leading:ok.
type T = number | undefined | null;
const items: T[] = [, 2, 3];
function view<U>(input: U[]): U[] { return input; }
const target = view<T>(items);
const result: T[] = []; for (const value of target) result.push(value);
assert.compareArray(result, [undefined, 2, 3]);
const originalOwn: boolean[] = []; for (let i = 0; i < target.length; i++) originalOwn.push(i in target);
assert.compareArray(originalOwn, [false, true, true]);
console.log("reading-forof-leading:ok");
