/*---
description: "lastIndexOf distinguishes an omitted start from explicit undefined and truncates starts on a readonly tuple. (control)"
features: [ts-array-method-routes, ts-array-method-route-reads, ts-arrays, ts-functions, ts-iteration, ts-numbers, ts-readonly, ts-tuples, ts-strings, ts-unions, ts-null-undefined]
---*/

function localLastIndexOf<T>(items: readonly T[], value: T, ...from: (number | undefined)[]): number {
  const supplied = from[0], input = from.length === 0 ? items.length - 1 : supplied === undefined ? 0 : supplied;
  if (input === -Infinity) return -1;
  const whole = input !== input ? 0 : input === Infinity ? items.length - 1 : input - input % 1;
  let start = whole < 0 ? items.length + whole : whole;
  if (start >= items.length) start = items.length - 1;
  for (let index = start; index >= 0; index--) if (items[index] === value) return index;
  return -1;
}
// lastIndexOf distinguishes an omitted start from explicit undefined and truncates starts on a readonly tuple. Route: a readonly string tuple and declared optional-number offsets. Node prints reads-last-index-of-readonly-defaults:ok.
const items: readonly [string, string, string] = ["a", "b", "a"];
const omitted = localLastIndexOf(items, "a"); assert.sameValue(omitted, 2);
const starts: readonly (number | undefined)[] = [undefined, NaN, -0, 1.9, 2.9, -4];
const expected: readonly number[] = [0, 0, 0, 0, 2, -1];
for (let i = 0; i < starts.length; i++) {
  const found = localLastIndexOf(items, "a", starts[i]);
  assert.sameValue(found, expected[i]);
}
const empty: readonly string[] = [];
const absent = localLastIndexOf(empty, "a"), explicit = localLastIndexOf(empty, "a", undefined);
assert.sameValue(absent, -1); assert.sameValue(explicit, -1);
assert.compareArray(items, ["a", "b", "a"]);
console.log("reads-last-index-of-readonly-defaults:ok");
