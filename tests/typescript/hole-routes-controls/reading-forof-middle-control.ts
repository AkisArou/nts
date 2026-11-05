/*---
description: "for...of visits all three positions and reads the middle hole as undefined. (control)"
features: [ts-hole-routes, ts-hole-route-reading, ts-arrays]
---*/

// for...of visits all three positions and reads the middle hole as undefined. Route: interface field. Node prints reading-forof-middle:ok.
type T = number | undefined | null;
const items: T[] = []; const present: boolean[] = [];
const source: readonly (readonly [boolean, T])[] = [[true, 1], [false, undefined], [true, 3]];
for (const entry of source) { items.push(entry[1]); present.push(entry[0]); }
function localForOf(data: T[], present: boolean[]): T[] { const result: T[] = []; for (let i = 0; i < data.length; i++) result.push(present[i] ? data[i] : undefined); return result; }
interface Supply { values: T[]; }
const holder: Supply = { values: items }; const target = holder.values;
const result = localForOf(target, present);
assert.compareArray(result, [1, undefined, 3]);
const originalOwn: boolean[] = []; for (let i = 0; i < target.length; i++) originalOwn.push(present[i]);
assert.compareArray(originalOwn, [true, false, true]);
console.log("reading-forof-middle:ok");
