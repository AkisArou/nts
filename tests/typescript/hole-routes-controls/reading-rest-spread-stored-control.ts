/*---
description: "spreading into rest parameters produces owned undefined arguments for a stored undefined and a hole. (control)"
features: [ts-hole-routes, ts-hole-route-reading, ts-arrays]
---*/

// spreading into rest parameters produces owned undefined arguments for a stored undefined and a hole. Route: readonly tuple row. Node prints reading-rest-spread-stored:ok.
type T = number | undefined | null;
const items: T[] = []; const present: boolean[] = [];
const source: readonly (readonly [boolean, T])[] = [[true, undefined], [false, undefined], [true, 3]];
for (const entry of source) { items.push(entry[1]); present.push(entry[0]); }
function localSpread(data: T[], present: boolean[]): T[] { const out: T[] = []; for (let i = 0; i < data.length; i++) out.push(present[i] ? data[i] : undefined); return out; }
const rows: readonly [string, T[]][] = [["x", items]];
const target = rows[0][1];
const result = localSpread(target, present);
assert.compareArray(result, [undefined, undefined, 3]);
const receivedOwn: boolean[] = []; for (let i = 0; i < result.length; i++) receivedOwn.push(i in result);
assert.compareArray(receivedOwn, [true, true, true]);
const originalOwn: boolean[] = []; for (let i = 0; i < target.length; i++) originalOwn.push(present[i]);
assert.compareArray(originalOwn, [true, false, true]);
console.log("reading-rest-spread-stored:ok");
