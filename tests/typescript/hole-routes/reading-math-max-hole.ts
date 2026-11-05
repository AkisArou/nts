/*---
description: "Math.max receives undefined from number[] holes through spread and returns NaN."
features: [ts-hole-routes, ts-hole-route-reading, ts-arrays]
---*/

// Math.max receives undefined from number[] holes through spread and returns NaN. Route: discriminated union. Node prints reading-math-max-hole:ok.
type T = number;
const items: T[] = new Array<number>(3);
type Choice = { kind: "a"; array: T[] } | { kind: "b"; array: T[] };
const selection: Choice = { kind: "a", array: items }; const target = selection.array;
const result = Math.max(...target);
assert.sameValue(result, NaN);
const originalOwn: boolean[] = []; for (let i = 0; i < target.length; i++) originalOwn.push(i in target);
assert.compareArray(originalOwn, [false, false, false]);
console.log("reading-math-max-hole:ok");
