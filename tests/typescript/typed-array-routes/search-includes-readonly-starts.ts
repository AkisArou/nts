/*---
description: "Includes truncates starts, counts negative starts from the end, and clamps both extremes."
features: [ts-typed-array-routes, ts-typed-array-route-search, ts-arrays, ts-functions, ts-iteration, ts-type-aliases, ts-numbers, ts-readonly, ts-tuples, ts-destructuring, ts-unions, ts-null-undefined]
---*/

// Includes truncates starts, counts negative starts from the end, and clamps both extremes. Route: readonly typed needle/start/answer rows. Node prints search-includes-readonly-starts:ok.
type Samples = Uint8Array;
const data: Samples = new Uint8Array([1, 2, 1, 2]);
const rows: readonly [number, number | undefined, boolean][] = [
  [1, 0, true], [1, 2, true], [1, 3, false], [1, 4, false], [2, -2, true], [1, -2, true],
  [1, -1, false], [1, -4, true], [1, -5, true], [1, -Infinity, true], [1, Infinity, false],
  [2, 1.9, true], [1, 2.9, true], [1, 3.9, false], [1, -1.9, false], [1, NaN, true], [2, undefined, true]
];
for (const [needle, start, expected] of rows) assert.sameValue(data.includes(needle, start), expected);
console.log("search-includes-readonly-starts:ok");
