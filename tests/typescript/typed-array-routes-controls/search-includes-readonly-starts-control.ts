/*---
description: "Includes truncates starts, counts negative starts from the end, and clamps both extremes. (control)"
features: [ts-typed-array-routes, ts-typed-array-route-search, ts-arrays, ts-functions, ts-iteration, ts-type-aliases, ts-numbers, ts-readonly, ts-tuples, ts-destructuring, ts-unions, ts-null-undefined]
---*/

function localUint8Array(input: readonly number[]): number[] { const result: number[] = []; for (let i = 0; i < input.length; i++) result[i] = input[i]; return result; }
function localInteger(value: number): number { return value !== value ? 0 : value === Infinity || value === -Infinity ? value : value - value % 1; }
function localIncludes<T extends number | bigint>(items: readonly T[], needle: T, fromIndex = 0): boolean {
  let first = localInteger(fromIndex); if (first < 0) first += items.length; if (first < 0) first = 0;
  for (let i = first; i < items.length; i++) if (items[i] === needle || items[i] !== items[i] && needle !== needle) return true; return false;
}
// Includes truncates starts, counts negative starts from the end, and clamps both extremes. Route: readonly typed needle/start/answer rows. Node prints search-includes-readonly-starts:ok.
type Samples = number[];
const data: Samples = localUint8Array([1, 2, 1, 2]);
const rows: readonly [number, number | undefined, boolean][] = [
  [1, 0, true], [1, 2, true], [1, 3, false], [1, 4, false], [2, -2, true], [1, -2, true],
  [1, -1, false], [1, -4, true], [1, -5, true], [1, -Infinity, true], [1, Infinity, false],
  [2, 1.9, true], [1, 2.9, true], [1, 3.9, false], [1, -1.9, false], [1, NaN, true], [2, undefined, true]
];
for (const [needle, start, expected] of rows) assert.sameValue(localIncludes(data, needle, start), expected);
console.log("search-includes-readonly-starts:ok");
