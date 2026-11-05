/*---
description: "String(array) prints both leading and trailing holes as empty comma-separated fields."
features: [ts-hole-routes, ts-hole-route-reading, ts-arrays]
---*/

// String(array) prints both leading and trailing holes as empty comma-separated fields. Route: interface field. Node prints reading-string-conversion:ok.
type T = number | undefined | null;
const items: T[] = [, 2, ,];
interface Supply { values: T[]; }
const holder: Supply = { values: items }; const target = holder.values;
const result = String(target);
assert.sameValue(result, ",2,");
const originalOwn: boolean[] = []; for (let i = 0; i < target.length; i++) originalOwn.push(i in target);
assert.compareArray(originalOwn, [false, true, false]);
console.log("reading-string-conversion:ok");
