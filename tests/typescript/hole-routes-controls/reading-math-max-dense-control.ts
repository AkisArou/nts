/*---
description: "Math.max applied to a dense numeric array returns its largest stored number. (control)"
features: [ts-hole-routes, ts-hole-route-reading, ts-arrays]
---*/

// Math.max applied to a dense numeric array returns its largest stored number. Route: interface field. Node prints reading-math-max-dense:ok.
type T = number;
const items: T[] = []; const present: boolean[] = [];
const source: readonly (readonly [boolean, T])[] = [[true, 1], [true, 5], [true, 3]];
for (const entry of source) { items.push(entry[1]); present.push(entry[0]); }
function localMax(data: number[], present: boolean[]): number { let maximum = -Infinity; for (let i = 0; i < data.length; i++) { if (!present[i]) return NaN; if (data[i] > maximum) maximum = data[i]; } return maximum; }
interface Supply { values: T[]; }
const holder: Supply = { values: items }; const target = holder.values;
const result = localMax(target, present);
assert.sameValue(result, 5);
const originalOwn: boolean[] = []; for (let i = 0; i < target.length; i++) originalOwn.push(present[i]);
assert.compareArray(originalOwn, [true, true, true]);
console.log("reading-math-max-dense:ok");
