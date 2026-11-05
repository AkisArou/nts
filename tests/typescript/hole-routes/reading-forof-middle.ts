/*---
description: "for...of visits all three positions and reads the middle hole as undefined."
features: [ts-hole-routes, ts-hole-route-reading, ts-arrays]
---*/

// for...of visits all three positions and reads the middle hole as undefined. Route: interface field. Node prints reading-forof-middle:ok.
type T = number | undefined | null;
const items: T[] = [1, , 3];
interface Supply { values: T[]; }
const holder: Supply = { values: items }; const target = holder.values;
const result: T[] = []; for (const value of target) result.push(value);
assert.compareArray(result, [1, undefined, 3]);
const originalOwn: boolean[] = []; for (let i = 0; i < target.length; i++) originalOwn.push(i in target);
assert.compareArray(originalOwn, [true, false, true]);
console.log("reading-forof-middle:ok");
