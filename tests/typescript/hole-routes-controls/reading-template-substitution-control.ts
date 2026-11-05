/*---
description: "template substitution stringifies a middle hole as an empty field, yielding 1,,3. (control)"
features: [ts-hole-routes, ts-hole-route-reading, ts-arrays]
---*/

// template substitution stringifies a middle hole as an empty field, yielding 1,,3. Route: generic helper. Node prints reading-template-substitution:ok.
type T = number | undefined | null;
const items: T[] = []; const present: boolean[] = [];
const source: readonly (readonly [boolean, T])[] = [[true, 1], [false, undefined], [true, 3]];
for (const entry of source) { items.push(entry[1]); present.push(entry[0]); }
function localTemplate(data: T[], present: boolean[]): string { let result = ""; for (let i = 0; i < data.length; i++) { if (i > 0) result += ","; if (present[i] && data[i] !== undefined && data[i] !== null) result += String(data[i]); } return result; }
function view<U>(input: U[]): U[] { return input; }
const target = view<T>(items);
const result = localTemplate(target, present);
assert.sameValue(result, "1,,3");
const originalOwn: boolean[] = []; for (let i = 0; i < target.length; i++) originalOwn.push(present[i]);
assert.compareArray(originalOwn, [true, false, true]);
console.log("reading-template-substitution:ok");
