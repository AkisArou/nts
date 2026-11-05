/*---
description: "String(array) prints both leading and trailing holes as empty comma-separated fields. (control)"
features: [ts-hole-routes, ts-hole-route-reading, ts-arrays]
---*/

// String(array) prints both leading and trailing holes as empty comma-separated fields. Route: interface field. Node prints reading-string-conversion:ok.
type T = number | undefined | null;
const items: T[] = []; const present: boolean[] = [];
const source: readonly (readonly [boolean, T])[] = [[false, undefined], [true, 2], [false, undefined]];
for (const entry of source) { items.push(entry[1]); present.push(entry[0]); }
function localString(data: T[], present: boolean[]): string { let result = ""; for (let i = 0; i < data.length; i++) { if (i > 0) result += ","; if (present[i] && data[i] !== undefined && data[i] !== null) result += String(data[i]); } return result; }
interface Supply { values: T[]; }
const holder: Supply = { values: items }; const target = holder.values;
const result = localString(target, present);
assert.sameValue(result, ",2,");
const originalOwn: boolean[] = []; for (let i = 0; i < target.length; i++) originalOwn.push(present[i]);
assert.compareArray(originalOwn, [false, true, false]);
console.log("reading-string-conversion:ok");
