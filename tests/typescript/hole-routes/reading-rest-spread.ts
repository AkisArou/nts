/*---
description: "spreading into rest parameters converts an absent middle index into an owned undefined argument."
features: [ts-hole-routes, ts-hole-route-reading, ts-arrays]
---*/

// spreading into rest parameters converts an absent middle index into an owned undefined argument. Route: captured closure. Node prints reading-rest-spread:ok.
type T = number | undefined | null;
const items: T[] = [1, , 3];
let pointer: T[] = items; const take = (): T[] => pointer; const target = take();
function collect(...values: T[]): T[] { return values; }
const result = collect(...target);
assert.compareArray(result, [1, undefined, 3]);
const receivedOwn: boolean[] = []; for (let i = 0; i < result.length; i++) receivedOwn.push(i in result);
assert.compareArray(receivedOwn, [true, true, true]);
const originalOwn: boolean[] = []; for (let i = 0; i < target.length; i++) originalOwn.push(i in target);
assert.compareArray(originalOwn, [true, false, true]);
console.log("reading-rest-spread:ok");
