/*---
description: "includes reads the current captured array and distinguishes dense empty, NaN, zero and nullish populations."
features: [ts-array-method-routes, ts-array-method-route-reads, ts-arrays, ts-functions, ts-iteration, ts-numbers, ts-type-aliases, ts-unions, ts-strings, ts-null-undefined, ts-readonly, ts-function-types, ts-arrow-functions, ts-closures]
---*/

// includes reads the current captured array and distinguishes dense empty, NaN, zero and nullish populations. Route: a typed callback closing over a rebound readonly-array binding. Node prints reads-includes-captured-let:ok.
type SearchValue = number | string | null | undefined;
let items: readonly SearchValue[] = [];
const contains: (value: SearchValue) => boolean = value => items.includes(value);
const sources: readonly (readonly SearchValue[])[] = [[], [NaN], [-0, undefined], [null, ""]];
const queries: readonly SearchValue[] = [NaN, -0, undefined, null, ""];
const expected: readonly (readonly boolean[])[] = [
  [false, false, false, false, false], [true, false, false, false, false],
  [false, true, true, false, false], [false, false, false, true, true]
];
for (let i = 0; i < sources.length; i++) {
  items = sources[i];
  for (let j = 0; j < queries.length; j++) assert.sameValue(contains(queries[j]), expected[i][j]);
}
console.log("reads-includes-captured-let:ok");
