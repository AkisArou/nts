/*---
description: "lastIndexOf distinguishes an omitted start from explicit undefined and truncates starts on a readonly tuple."
features: [ts-array-method-routes, ts-array-method-route-reads, ts-arrays, ts-functions, ts-iteration, ts-numbers, ts-readonly, ts-tuples, ts-strings, ts-unions, ts-null-undefined]
---*/

// lastIndexOf distinguishes an omitted start from explicit undefined and truncates starts on a readonly tuple. Route: a readonly string tuple and declared optional-number offsets. Node prints reads-last-index-of-readonly-defaults:ok.
const items: readonly [string, string, string] = ["a", "b", "a"];
const omitted = items.lastIndexOf("a"); assert.sameValue(omitted, 2);
const starts: readonly (number | undefined)[] = [undefined, NaN, -0, 1.9, 2.9, -4];
const expected: readonly number[] = [0, 0, 0, 0, 2, -1];
for (let i = 0; i < starts.length; i++) {
  const found = items.lastIndexOf("a", starts[i]);
  assert.sameValue(found, expected[i]);
}
const empty: readonly string[] = [];
const absent = empty.lastIndexOf("a"), explicit = empty.lastIndexOf("a", undefined);
assert.sameValue(absent, -1); assert.sameValue(explicit, -1);
assert.compareArray(items, ["a", "b", "a"]);
console.log("reads-last-index-of-readonly-defaults:ok");
