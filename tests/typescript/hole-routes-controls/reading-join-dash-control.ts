/*---
description: "join('-') prints a hole, stored undefined and null as empty fields between numbered endpoints. (control)"
features: [ts-hole-routes, ts-hole-route-reading, ts-arrays]
---*/

// join('-') prints a hole, stored undefined and null as empty fields between numbered endpoints. Route: captured closure. Node prints reading-join-dash:ok.
type T = number | undefined | null;
const items: T[] = []; const present: boolean[] = [];
const source: readonly (readonly [boolean, T])[] = [[true, 1], [false, undefined], [true, undefined], [true, null], [true, 3]];
for (const entry of source) { items.push(entry[1]); present.push(entry[0]); }
function localJoin(data: T[], present: boolean[], separator: string = ","): string { let result = ""; for (let i = 0; i < data.length; i++) { if (i > 0) result += separator; if (present[i] && data[i] !== undefined && data[i] !== null) result += String(data[i]); } return result; }
let pointer: T[] = items; const take = (): T[] => pointer; const target = take();
const result = localJoin(target, present, "-");
assert.sameValue(result, "1----3");
const originalOwn: boolean[] = []; for (let i = 0; i < target.length; i++) originalOwn.push(present[i]);
assert.compareArray(originalOwn, [true, false, true, true, true]);
console.log("reading-join-dash:ok");
