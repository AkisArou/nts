/*---
description: "Math.max receives undefined from number[] holes through spread and returns NaN. (control)"
features: [ts-hole-routes, ts-hole-route-reading, ts-arrays]
---*/

// Math.max receives undefined from number[] holes through spread and returns NaN. Route: discriminated union. Node prints reading-math-max-hole:ok.
type T = number;
const items: T[] = []; const present: boolean[] = [];
const source: readonly (readonly [boolean, T | undefined])[] = [[false, undefined], [false, undefined], [false, undefined]];
for (const entry of source) { items.push(entry[1] === undefined ? 0 : entry[1]); present.push(entry[0]); }
function localMax(data: number[], present: boolean[]): number { let maximum = -Infinity; for (let i = 0; i < data.length; i++) { if (!present[i]) return NaN; if (data[i] > maximum) maximum = data[i]; } return maximum; }
type Choice = { kind: "a"; array: T[] } | { kind: "b"; array: T[] };
const selection: Choice = { kind: "a", array: items }; const target = selection.array;
const result = localMax(target, present);
assert.sameValue(result, NaN);
const originalOwn: boolean[] = []; for (let i = 0; i < target.length; i++) originalOwn.push(present[i]);
assert.compareArray(originalOwn, [false, false, false]);
console.log("reading-math-max-hole:ok");
