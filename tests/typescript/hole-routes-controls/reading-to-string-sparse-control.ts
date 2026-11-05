/*---
description: "Array.toString prints the missing middle element as an empty field. (control)"
features: [ts-hole-routes, ts-hole-route-reading, ts-arrays]
---*/

// Array.toString prints the missing middle element as an empty field. Route: discriminated union. Node prints reading-to-string-sparse:ok.
type T = number | undefined | null;
const items: T[] = []; const present: boolean[] = [];
const source: readonly (readonly [boolean, T])[] = [[true, 1], [false, undefined], [true, 3]];
for (const entry of source) { items.push(entry[1]); present.push(entry[0]); }
function localToString(data: T[], present: boolean[]): string { let result = ""; for (let i = 0; i < data.length; i++) { if (i > 0) result += ","; if (present[i] && data[i] !== undefined && data[i] !== null) result += String(data[i]); } return result; }
type Choice = { kind: "a"; array: T[] } | { kind: "b"; array: T[] };
const selection: Choice = { kind: "a", array: items }; const target = selection.array;
const result = localToString(target, present);
assert.sameValue(result, "1,,3");
const originalOwn: boolean[] = []; for (let i = 0; i < target.length; i++) originalOwn.push(present[i]);
assert.compareArray(originalOwn, [true, false, true]);
console.log("reading-to-string-sparse:ok");
