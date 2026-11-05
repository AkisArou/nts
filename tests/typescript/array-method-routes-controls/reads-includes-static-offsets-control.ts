/*---
description: "includes applies forward-search start normalization for positive, negative, fractional and infinite offsets. (control)"
features: [ts-array-method-routes, ts-array-method-route-reads, ts-arrays, ts-functions, ts-iteration, ts-numbers, ts-class, ts-class-fields, ts-static, ts-readonly, ts-tuples, ts-destructuring]
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
// includes applies forward-search start normalization for positive, negative, fractional and infinite offsets. Route: a static readonly number-array field. Node prints reads-includes-static-offsets:ok.
class IncludesStore { static items: readonly number[] = [1, 2, 3]; }
const rows: readonly [number, number, boolean][] = [
  [1, 1, false], [3, -1, true], [1, -10, true], [1, 10, false], [3, 3, false],
  [2, 1.9, true], [2, 2.9, false], [1, NaN, true], [1, Infinity, false], [1, -Infinity, true],
  [1, -0.9, true], [2, -1.9, false], [2, -2.9, true]
];
for (const [needle, start, expected] of rows) {
  const found = localIncludes(IncludesStore.items, needle, start);
  assert.sameValue(found, expected);
}
assert.compareArray(IncludesStore.items, [1, 2, 3]);
console.log("reads-includes-static-offsets:ok");
