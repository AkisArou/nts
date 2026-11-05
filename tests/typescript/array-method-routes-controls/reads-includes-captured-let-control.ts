/*---
description: "includes reads the current captured array and distinguishes dense empty, NaN, zero and nullish populations. (control)"
features: [ts-array-method-routes, ts-array-method-route-reads, ts-arrays, ts-functions, ts-iteration, ts-numbers, ts-type-aliases, ts-unions, ts-strings, ts-null-undefined, ts-readonly, ts-function-types, ts-arrow-functions, ts-closures]
---*/

function localIncludes<T>(items: readonly T[], value: T, from: number = 0): boolean {
  if (from === Infinity) return false;
  const whole = from !== from || from === -Infinity ? 0 : from - from % 1;
  let start = whole < 0 ? items.length + whole : whole;
  if (start < 0) start = 0;
  for (let index = start; index < items.length; index++) {
    const item = items[index]; if (item === value || item !== item && value !== value) return true;
  }
  return false;
}
// includes reads the current captured array and distinguishes dense empty, NaN, zero and nullish populations. Route: a typed callback closing over a rebound readonly-array binding. Node prints reads-includes-captured-let:ok.
type SearchValue = number | string | null | undefined;
let items: readonly SearchValue[] = [];
const contains: (value: SearchValue) => boolean = value => localIncludes(items, value);
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
