/*---
description: "join prints a hole, stored undefined and null as empty fields separated by commas. (control)"
features: [ts-hole-routes, ts-hole-route-reading, ts-arrays]
---*/

// join prints a hole, stored undefined and null as empty fields separated by commas. Route: readonly tuple row. Node prints reading-join-all-empty:ok.
type T = number | undefined | null;
const items: T[] = []; const present: boolean[] = [];
const source: readonly (readonly [boolean, T])[] = [[false, undefined], [true, undefined], [true, null]];
for (const entry of source) { items.push(entry[1]); present.push(entry[0]); }
function localJoin(data: T[], present: boolean[], separator: string = ","): string { let result = ""; for (let i = 0; i < data.length; i++) { if (i > 0) result += separator; if (present[i] && data[i] !== undefined && data[i] !== null) result += String(data[i]); } return result; }
const rows: readonly [string, T[]][] = [["x", items]];
const target = rows[0][1];
const result = localJoin(target, present);
assert.sameValue(result, ",,");
const originalOwn: boolean[] = []; for (let i = 0; i < target.length; i++) originalOwn.push(present[i]);
assert.compareArray(originalOwn, [false, true, true]);
console.log("reading-join-all-empty:ok");
