/*---
description: "spreading into rest parameters produces owned undefined arguments for a stored undefined and a hole."
features: [ts-hole-routes, ts-hole-route-reading, ts-arrays]
---*/

// spreading into rest parameters produces owned undefined arguments for a stored undefined and a hole. Route: readonly tuple row. Node prints reading-rest-spread-stored:ok.
type T = number | undefined | null;
const items: T[] = [undefined, , 3];
const rows: readonly [string, T[]][] = [["x", items]];
const target = rows[0][1];
function collect(...values: T[]): T[] { return values; }
const result = collect(...target);
assert.compareArray(result, [undefined, undefined, 3]);
const receivedOwn: boolean[] = []; for (let i = 0; i < result.length; i++) receivedOwn.push(i in result);
assert.compareArray(receivedOwn, [true, true, true]);
const originalOwn: boolean[] = []; for (let i = 0; i < target.length; i++) originalOwn.push(i in target);
assert.compareArray(originalOwn, [true, false, true]);
console.log("reading-rest-spread-stored:ok");
